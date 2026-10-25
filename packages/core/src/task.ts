export * as Task from "./task.js"

import { Database } from "@ren/db/database"
import { Label } from "@ren/schema/label"
import { Session } from "@ren/schema/session"
import { Task } from "@ren/schema/task"
import type { TaskEvent } from "@ren/schema/task-event"
import { TaskLink } from "@ren/schema/task-link"
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Array, Context, DateTime, Effect, Layer, Option, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { AgentQueries } from "./agent/queries.js"
import { Primitive } from "./primitive.js"
import { SessionRunner } from "./session/runner.js"
import { TaskPolicy } from "./task/policy.js"
import { TaskQueries } from "./task/queries.js"
import { TaskStart } from "./task/start.js"
import { TaskTrail } from "./task/trail.js"

export interface HandOff {
  readonly task: Task.Info
  readonly start: "none" | "started" | "failed"
}

type AssignError = Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid

export type Interface = Omit<Primitive.Interface<typeof Task.definition>, "assign"> & {
  readonly assign: (actor: Actor.Info, id: Task.ID, input: Task.AssignInput) => Effect.Effect<Task.Info, AssignError>
  readonly handOff: (actor: Actor.Info, id: Task.ID, input: Task.AssignInput) => Effect.Effect<HandOff, AssignError>
}

export const reviewStart: "continue" | "none" = "continue"

export class Service extends Context.Service<Service, Interface>()("@ren/core/Task") {}

const actions = {
  list: Primitive.action(Task.definition, "list"),
  create: Primitive.action(Task.definition, "create"),
  update: Primitive.action(Task.definition, "update"),
  archive: Primitive.action(Task.definition, "archive"),
  assign: Primitive.action(Task.definition, "assign"),
  start: Primitive.action(Task.definition, "start"),
  review: Primitive.action(Task.definition, "review"),
}

const closed: ReadonlySet<Task.Status> = new Set(["done", "dismissed"])

const refKey = (ref: TaskLink.Ref) => `${ref.kind}\u0000${ref.key}`

const identifier = /^(?<prefix>.+)-(?<number>\d+)$/u

const iso = (date: Date | null) => date && DateTime.formatIso(DateTime.fromDateUnsafe(date))

const setLabels = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  task: TaskTrail.Target,
  names: ReadonlyArray<string>,
  options: { readonly canCreate: boolean },
): Effect.fn.Return<ReadonlyArray<TaskEvent.Data>, Primitive.Invalid | EffectDrizzleQueryError> {
  const unique = Array.dedupeWith(names, (a, b) => a.toLowerCase() === b.toLowerCase())
  const find = transaction
    .select({ id: Database.Schema.label.id, name: Database.Schema.label.name })
    .from(Database.Schema.label)
    .where(
      and(
        or(
          eq(Database.Schema.label.organization_id, task.organizationId),
          isNull(Database.Schema.label.organization_id),
        ),
        isNull(Database.Schema.label.archived_at),
        inArray(
          sql`lower(${Database.Schema.label.name})`,
          unique.map((name) => name.toLowerCase()),
        ),
      ),
    )
    .orderBy(sql`lower(${Database.Schema.label.name})`)
    // oxlint-disable-next-line ren/no-comments -- The lock holds Label.archive off until this commits, so its cleanup also removes the task_label rows written here.
    .for("share")
  const existing = yield* find
  const found = new Set(existing.map((label) => label.name.toLowerCase()))
  const missing = unique.filter((name) => !found.has(name.toLowerCase()))
  if (missing.length > 0 && !options.canCreate)
    return yield* new Primitive.Invalid({ message: `No label is named ${missing.join(", ")}.`, field: "labels" })
  if (missing.length > 0)
    yield* transaction
      .insert(Database.Schema.label)
      .values(missing.map((name) => ({ id: Label.ID.create(), organization_id: task.organizationId, name })))
      .onConflictDoNothing()
  const resolved = missing.length > 0 ? yield* find : existing
  const before = yield* transaction
    .select({ id: Database.Schema.label.id, name: Database.Schema.label.name })
    .from(Database.Schema.task_label)
    .innerJoin(Database.Schema.label, eq(Database.Schema.label.id, Database.Schema.task_label.label_id))
    .where(eq(Database.Schema.task_label.task_id, task.id))
    .orderBy(sql`lower(${Database.Schema.label.name})`)
  const resolvedIds = new Set(resolved.map((label) => label.id))
  if (before.length === resolved.length && before.every((label) => resolvedIds.has(label.id))) return []
  yield* transaction.delete(Database.Schema.task_label).where(eq(Database.Schema.task_label.task_id, task.id))
  if (resolved.length > 0)
    yield* transaction
      .insert(Database.Schema.task_label)
      .values(resolved.map((label) => ({ task_id: task.id, label_id: label.id })))
  return [{ _tag: "label", from: before.map((label) => label.name), to: resolved.map((label) => label.name) }]
})

const editLinks = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  task: TaskTrail.Target,
  add: ReadonlyArray<string>,
  remove: ReadonlyArray<string>,
): Effect.fn.Return<ReadonlyArray<TaskEvent.Data>, Primitive.Invalid | EffectDrizzleQueryError> {
  if (add.length === 0 && remove.length === 0) return []
  const current = yield* transaction
    .select()
    .from(Database.Schema.task_link)
    .where(eq(Database.Schema.task_link.task_id, task.id))
    .orderBy(asc(Database.Schema.task_link.created_at), asc(Database.Schema.task_link.id))
  const removeIds = new Set(remove)
  const removeKeys = new Set(
    remove.filter((value) => !Schema.is(TaskLink.ID)(value)).map((url) => refKey(TaskLink.classify(url))),
  )
  const removed = current.filter((link) => removeIds.has(link.id) || removeKeys.has(refKey(link)))
  const removedIds = new Set(removed.map((link) => link.id))
  const kept = current.filter((link) => !removedIds.has(link.id))
  const keptKeys = new Set(kept.map(refKey))
  const added = Array.dedupeWith(
    add.map((url) => ({ ...TaskLink.classify(url), url })).filter((ref) => !keptKeys.has(refKey(ref))),
    (a, b) => refKey(a) === refKey(b),
  )
  if (kept.length + added.length > Task.maximumLinks)
    return yield* new Primitive.Invalid({ message: `A task has at most ${Task.maximumLinks} links.`, field: "links" })
  if (removed.length === 0 && added.length === 0) return []
  if (removed.length > 0)
    yield* transaction.delete(Database.Schema.task_link).where(
      inArray(
        Database.Schema.task_link.id,
        removed.map((link) => link.id),
      ),
    )
  if (added.length > 0)
    yield* transaction.insert(Database.Schema.task_link).values(
      added.map((ref) => ({
        id: TaskLink.ID.create(),
        task_id: task.id,
        organization_id: task.organizationId,
        kind: ref.kind,
        key: ref.key,
        url: ref.url,
      })),
    )
  return [{ _tag: "link", added: added.map((ref) => ref.url), removed: removed.map((link) => link.url) }]
})

const editParent = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  row: TaskQueries.Row,
  parent: TaskQueries.Row | undefined,
  parentId: Task.ID | null | undefined,
): Effect.fn.Return<ReadonlyArray<TaskEvent.Data>, Primitive.Invalid | EffectDrizzleQueryError> {
  if (Predicate.isUndefined(parentId) || parentId === row.task.parent_id) return []
  if (parent && parent.task.space_id !== row.task.space_id)
    return yield* new Primitive.Invalid({ message: "A subtask is in its parent’s space.", field: "parentId" })
  if (parentId) {
    const live = yield* transaction
      .select({ id: Database.Schema.task.id })
      .from(Database.Schema.task)
      .where(and(eq(Database.Schema.task.parent_id, row.task.id), isNull(Database.Schema.task.archived_at)))
      .limit(1)
    if (live.length > 0)
      return yield* new Primitive.Invalid({
        message: "A task with subtasks cannot become a subtask.",
        field: "parentId",
      })
    yield* transaction
      .update(Database.Schema.task)
      .set({ parent_id: null })
      .where(eq(Database.Schema.task.parent_id, row.task.id))
  }
  yield* transaction
    .update(Database.Schema.task)
    .set({ parent_id: parentId })
    .where(eq(Database.Schema.task.id, row.task.id))
  return [{ _tag: "parent", from: row.task.parent_id, to: parentId }]
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const runner = yield* SessionRunner.Service

    const reread = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, id: Task.ID) {
      const rows = yield* TaskQueries.select(transaction, actor).where(eq(Database.Schema.task.id, id))
      const info = (yield* TaskQueries.present(transaction, access, actor, rows)).at(0)
      if (!info) return yield* TaskQueries.notFound
      return info
    })

    const read = (actor: Actor.Info, id: Task.ID) =>
      database.transaction((transaction) => reread(transaction, actor, id))

    const launch = Effect.fnUntraced(function* (
      actor: Actor.Info,
      id: Task.ID,
      mode: Task.StartMode,
      review?: TaskStart.Review,
    ) {
      const where = eq(Database.Schema.task.id, id)
      const planned = yield* database.transaction((transaction) =>
        TaskQueries.find(transaction, access, actor, where, actions.start).pipe(
          Effect.flatMap((row) =>
            TaskStart.plan(transaction, row, mode, review).pipe(Effect.map((plan) => ({ plan, task: row.task }))),
          ),
        ),
      )
      const message = {
        messageId: Session.MessageID.create(),
        prompt: { text: planned.plan.text },
        sender: { userId: actor.userId, memberId: yield* Actor.memberOf(database.db, actor) },
      }
      const sessionId = planned.plan.sessionId ?? Session.ID.create()
      yield* planned.plan.sessionId
        ? runner
            .send({ ...message, sessionId, delivery: "queue" })
            .pipe(Effect.catchTag("SessionRunner.NotFound", Effect.die))
        : runner
            .create(
              { organizationId: planned.task.organization_id, spaceId: planned.task.space_id, createdBy: actor.userId },
              { sessionId, harness: "opencode", interactive: true, initialMessage: message },
              planned.plan.isGlobal ? {} : { agentId: planned.plan.agentId },
            )
            .pipe(
              Effect.catchTags({
                "SessionRunner.AlreadyExists": Effect.die,
                "SessionRunner.NotFound": () =>
                  Effect.fail(new Primitive.Conflict({ message: "The task’s agent is no longer available." })),
              }),
            )
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const row = yield* TaskQueries.lockForWrite(transaction, access, actor, where, actions.start)
          if (!planned.plan.sessionId)
            yield* transaction
              .insert(Database.Schema.task_session)
              .values({ task_id: id, session_id: sessionId, agent_id: planned.plan.agentId })
          yield* transaction
            .update(Database.Schema.task)
            .set({ updated_at: sql`now()`, ...(row.task.status === "todo" && { status: "in_progress" as const }) })
            .where(eq(Database.Schema.task.id, id))
          yield* TaskTrail.record(transaction, { id, organizationId: row.task.organization_id }, actor, [
            { _tag: "started", agentId: planned.plan.agentId, sessionId, mode },
            ...(row.task.status === "todo" ? [{ _tag: "status", from: "todo", to: "in_progress" } as const] : []),
          ])
          return yield* reread(transaction, actor, id)
        }),
      )
    })

    const launchAfterCommit = (actor: Actor.Info, id: Task.ID, mode: Task.StartMode, review?: TaskStart.Review) =>
      launch(actor, id, mode, review).pipe(
        Effect.catch((error) => Effect.logWarning("The task’s agent did not start", error)),
        Effect.andThen(read(actor, id)),
      )

    const decide = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      row: TaskQueries.Row,
      actor: Actor.Info,
      input: Extract<Task.ReviewInput, { readonly humanReview: false }>,
    ) {
      if (!row.task.human_review) return yield* new Primitive.Conflict({ message: "This task has no open review." })
      const requested = transaction
        .select({ at: sql`max(${Database.Schema.task_event.created_at})` })
        .from(Database.Schema.task_event)
        .where(
          and(
            eq(Database.Schema.task_event.task_id, row.task.id),
            eq(Database.Schema.task_event.kind, "review_requested"),
          ),
        )
      const edits = yield* transaction
        .select({ id: Database.Schema.task_event.id })
        .from(Database.Schema.task_event)
        .where(
          and(
            eq(Database.Schema.task_event.task_id, row.task.id),
            eq(Database.Schema.task_event.kind, "field"),
            sql`${Database.Schema.task_event.data} ->> 'field' = 'description'`,
            gt(Database.Schema.task_event.created_at, sql`(${requested})`),
          ),
        )
        .limit(1)
      yield* transaction
        .update(Database.Schema.task)
        .set({ human_review: false, human_review_reason: null, updated_at: sql`now()` })
        .where(eq(Database.Schema.task.id, row.task.id))
      const comment = input.comment ?? null
      yield* TaskTrail.record(transaction, { id: row.task.id, organizationId: row.task.organization_id }, actor, [
        { _tag: "reviewed", decision: input.decision, comment },
      ])
      return { decision: input.decision, comment, descriptionChanged: edits.length > 0 }
    })

    const nextAssignment = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      row: TaskQueries.Row,
      input: Task.AssignInput,
    ) {
      const spaceId = input.spaceId ?? row.task.space_id
      const moves = spaceId !== row.task.space_id
      if (moves && row.task.parent_id)
        return yield* new Primitive.Invalid({ message: "A subtask moves only with its parent.", field: "spaceId" })
      if (moves) yield* TaskQueries.writableSpace(transaction, access, actor, spaceId, actions.assign)
      const agentId = Predicate.isUndefined(input.agentId) ? row.task.agent_id : input.agentId
      const owner = row.task.owner_id
      const ownerStays = !moves || !owner || (yield* AgentQueries.isMember(transaction, spaceId, owner))
      const keptOwner = ownerStays ? owner : null
      yield* TaskQueries.checkAssignment(transaction, row.task.organization_id, spaceId, {
        agentId: moves || agentId !== row.task.agent_id ? agentId : null,
        ownerId: input.ownerId,
      })
      return { spaceId, agentId, ownerId: Predicate.isUndefined(input.ownerId) ? keptOwner : input.ownerId }
    })

    const refuseClosing = (actor: Actor.Info, status: Task.Status | undefined) =>
      actor.agent && status && closed.has(status)
        ? Effect.fail(new Primitive.Forbidden({ message: "Only a person marks a task done or dismissed." }))
        : Effect.void

    const handOff = Effect.fn("Task.handOff")(function* (
      actor: Actor.Info,
      id: Task.ID,
      input: Task.AssignInput,
    ): Effect.fn.Return<HandOff, AssignError> {
      const assigned = yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const row = yield* TaskQueries.lockForWrite(
            transaction,
            access,
            actor,
            eq(Database.Schema.task.id, id),
            actions.assign,
          )
          const next = yield* nextAssignment(transaction, actor, row, input)
          const changed =
            next.spaceId !== row.task.space_id ||
            next.agentId !== row.task.agent_id ||
            next.ownerId !== row.task.owner_id
          if (changed || input.note) {
            yield* transaction
              .update(Database.Schema.task)
              .set({
                space_id: next.spaceId,
                agent_id: next.agentId,
                owner_id: next.ownerId,
                updated_at: sql`now()`,
                ...(!next.agentId && { human_review: false, human_review_reason: null }),
              })
              .where(eq(Database.Schema.task.id, id))
            yield* TaskTrail.record(transaction, { id, organizationId: row.task.organization_id }, actor, [
              {
                _tag: "assigned",
                fromAgentId: row.task.agent_id,
                toAgentId: next.agentId,
                fromOwnerId: row.task.owner_id,
                toOwnerId: next.ownerId,
                fromSpaceId: row.task.space_id,
                toSpaceId: next.spaceId,
                note: input.note ?? null,
              },
            ])
          }
          if (next.spaceId !== row.task.space_id) {
            const subtasks = yield* transaction
              .select({
                id: Database.Schema.task.id,
                agentId: Database.Schema.task.agent_id,
                ownerId: Database.Schema.task.owner_id,
                toAgentId: Database.Schema.agent.id,
                toOwnerId: Database.Schema.space_member.user_id,
              })
              .from(Database.Schema.task)
              .leftJoin(
                Database.Schema.agent,
                and(
                  eq(Database.Schema.agent.id, Database.Schema.task.agent_id),
                  AgentQueries.isUsableIn(next.spaceId, row.task.organization_id),
                ),
              )
              .leftJoin(
                Database.Schema.space_member,
                and(
                  eq(Database.Schema.space_member.user_id, Database.Schema.task.owner_id),
                  eq(Database.Schema.space_member.space_id, next.spaceId),
                  isNull(Database.Schema.space_member.archived_at),
                ),
              )
              .where(and(eq(Database.Schema.task.parent_id, id), isNull(Database.Schema.task.archived_at)))
              .orderBy(asc(Database.Schema.task.id))
              .for("update", { of: Database.Schema.task })
            yield* Effect.forEach(subtasks, (subtask) =>
              Effect.gen(function* () {
                yield* transaction
                  .update(Database.Schema.task)
                  .set({
                    agent_id: subtask.toAgentId,
                    owner_id: subtask.toOwnerId,
                    updated_at: sql`now()`,
                    ...(subtask.agentId && !subtask.toAgentId && { human_review: false, human_review_reason: null }),
                  })
                  .where(eq(Database.Schema.task.id, subtask.id))
                yield* TaskTrail.record(
                  transaction,
                  { id: subtask.id, organizationId: row.task.organization_id },
                  actor,
                  [
                    {
                      _tag: "assigned",
                      fromAgentId: subtask.agentId,
                      toAgentId: subtask.toAgentId,
                      fromOwnerId: subtask.ownerId,
                      toOwnerId: subtask.toOwnerId,
                      fromSpaceId: row.task.space_id,
                      toSpaceId: next.spaceId,
                      note: null,
                    },
                  ],
                )
              }),
            )
          }
          return { hasAgent: Boolean(next.agentId), agentChanged: next.agentId !== row.task.agent_id }
        }),
      )
      const start = input.start ?? (assigned.agentChanged ? "continue" : "none")
      if (start === "none" || !assigned.hasAgent) return { task: yield* read(actor, id), start: "none" }
      const started = yield* launch(actor, id, start).pipe(
        Effect.as("started" as const),
        Effect.catch((error) =>
          Effect.logWarning("The task’s agent did not start", error).pipe(Effect.as("failed" as const)),
        ),
      )
      return { task: yield* read(actor, id), start: started }
    })

    return Service.of({
      list: Effect.fn("Task.list")(function* (actor: Actor.Info, input: Task.ListInput) {
        const linked = input.linkedTo && TaskLink.classify(input.linkedTo)
        const parent = TaskQueries.byParent(input.parentId)
        const where = and(
          TaskQueries.visibleTo(access, actor),
          input.spaceId ? eq(Database.Schema.task.space_id, input.spaceId) : undefined,
          input.status ? eq(Database.Schema.task.status, input.status) : undefined,
          input.status || input.includeDone ? undefined : inArray(Database.Schema.task.status, Task.actionable),
          input.priority ? eq(Database.Schema.task.priority, input.priority) : undefined,
          input.agentId ? eq(Database.Schema.task.agent_id, input.agentId) : undefined,
          input.ownerId ? eq(Database.Schema.task.owner_id, input.ownerId) : undefined,
          Predicate.isBoolean(input.humanReview) ? eq(Database.Schema.task.human_review, input.humanReview) : undefined,
          input.label
            ? sql`exists (
                select 1 from ${Database.Schema.task_label}
                inner join ${Database.Schema.label} on ${Database.Schema.label.id} = ${Database.Schema.task_label.label_id}
                where ${Database.Schema.task_label.task_id} = ${Database.Schema.task.id}
                  and lower(${Database.Schema.label.name}) = ${input.label.toLowerCase()}
              )`
            : undefined,
          linked
            ? sql`exists (
                select 1 from ${Database.Schema.task_link}
                where ${Database.Schema.task_link.task_id} = ${Database.Schema.task.id}
                  and ${Database.Schema.task_link.kind} = ${linked.kind}
                  and ${Database.Schema.task_link.key} = ${linked.key}
              )`
            : undefined,
          parent.where,
        )
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.list, resource: TaskPolicy.organization }))
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            const rows = yield* TaskQueries.select(transaction, actor)
              .where(where)
              .orderBy(parent.order(Database.Schema.task.created_at), parent.order(Database.Schema.task.number))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(Database.Schema.task)
              .leftJoin(TaskPolicy.membership, TaskQueries.membershipOf(actor))
              .where(where)
            return {
              items: yield* TaskQueries.present(transaction, access, actor, rows),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Task.get")(function* (actor: Actor.Info, idOrSlug: string) {
        const parts = identifier.exec(idOrSlug)?.groups
        const byIdentifier =
          parts?.prefix && parts.number
            ? and(
                eq(Database.Schema.task_sequence.prefix, parts.prefix.toUpperCase()),
                eq(Database.Schema.task.number, Number(parts.number)),
              )
            : undefined
        const where = Schema.is(Task.ID)(idOrSlug) ? eq(Database.Schema.task.id, idOrSlug) : byIdentifier
        if (!where) return yield* TaskQueries.notFound
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* TaskQueries.select(transaction, actor).where(
              and(where, TaskQueries.visibleTo(access, actor)),
            )
            const info = (yield* TaskQueries.present(transaction, access, actor, rows)).at(0)
            if (!info) return yield* TaskQueries.notFound
            return info
          }),
        )
      }),
      create: Effect.fn("Task.create")(function* (actor: Actor.Info, input: Task.CreateInput) {
        yield* refuseClosing(actor, input.status)
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* TaskQueries.writableSpace(transaction, access, actor, input.spaceId, actions.create)
            yield* TaskQueries.checkAssignment(transaction, actor.organizationId, input.spaceId, input)
            const parent = yield* TaskQueries.lockParent(transaction, access, actor, input.parentId)
            if (parent && parent.task.space_id !== input.spaceId)
              return yield* new Primitive.Invalid({ message: "A subtask is in its parent’s space.", field: "parentId" })
            const sequence = (yield* transaction
              .insert(Database.Schema.task_sequence)
              .values({
                organization_id: actor.organizationId,
                prefix: sql`(select upper(${Database.Schema.organization.slug}) from ${Database.Schema.organization}
                  where ${Database.Schema.organization.id} = ${actor.organizationId})`,
                last_number: 1,
              })
              .onConflictDoUpdate({
                target: Database.Schema.task_sequence.organization_id,
                set: { last_number: sql`${Database.Schema.task_sequence.last_number} + 1` },
              })
              .returning({ number: Database.Schema.task_sequence.last_number })).at(0)
            if (!sequence) return yield* Effect.die(new Error("The task sequence returned no number"))
            const by = TaskQueries.actorOf(actor)
            const task = { id: Task.ID.create(), organizationId: actor.organizationId }
            yield* transaction.insert(Database.Schema.task).values({
              id: task.id,
              organization_id: actor.organizationId,
              space_id: input.spaceId,
              parent_id: input.parentId,
              number: sequence.number,
              title: input.title,
              description: input.description,
              status: input.status,
              priority: input.priority,
              due_at: input.dueAt && DateTime.toDateUtc(input.dueAt),
              agent_id: input.agentId,
              owner_id: input.ownerId,
              created_by_user_id: by.userId,
              created_by_agent_id: by.agentId,
              created_by_session_id: by.sessionId,
            })
            if (actor.agent)
              yield* transaction
                .insert(Database.Schema.task_session)
                .values({ task_id: task.id, session_id: actor.agent.sessionId, agent_id: actor.agent.agentId })
            const labels = input.labels
              ? yield* setLabels(transaction, task, input.labels, { canCreate: !actor.agent })
              : []
            const links = yield* editLinks(transaction, task, input.links ?? [], [])
            yield* TaskTrail.record(transaction, task, actor, [{ _tag: "created" }, ...labels, ...links])
            return yield* reread(transaction, actor, task.id)
          }),
        )
      }),
      update: Effect.fn("Task.update")(function* (actor: Actor.Info, id: Task.ID, input: Task.UpdateInput) {
        yield* refuseClosing(actor, input.status)
        if (input.parentId === id)
          return yield* new Primitive.Invalid({ message: "A task cannot be its own parent.", field: "parentId" })
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            // oxlint-disable-next-line ren/no-comments -- Reparents in one organization take turns, so two tasks made each other's parent cannot lock their rows in opposite orders.
            if (input.parentId)
              yield* transaction.execute(
                sql`select pg_advisory_xact_lock(hashtext('task.parent'), hashtext(${actor.organizationId}))`,
              )
            const parent = yield* TaskQueries.lockParent(transaction, access, actor, input.parentId)
            const row = yield* TaskQueries.lockForWrite(
              transaction,
              access,
              actor,
              eq(Database.Schema.task.id, id),
              actions.update,
            )
            const task = { id, organizationId: row.task.organization_id }
            const status = input.status !== row.task.status ? input.status : undefined
            const dueAt = input.dueAt && DateTime.toDateUtc(input.dueAt)
            const changed = [
              { field: "title", from: row.task.title, to: input.title },
              { field: "description", from: row.task.description, to: input.description },
              { field: "priority", from: row.task.priority, to: input.priority },
              { field: "dueAt", from: iso(row.task.due_at), to: input.dueAt && DateTime.formatIso(input.dueAt) },
            ].filter(
              (change): change is { field: TaskEvent.Field; from: string | null; to: string | null } =>
                Predicate.isNotUndefined(change.to) && change.to !== change.from,
            )
            const content: ReadonlyArray<TaskEvent.Data> = [
              ...(status ? [{ _tag: "status", from: row.task.status, to: status } as const] : []),
              ...changed.map(
                (change) => ({ _tag: "field", field: change.field, from: change.from, to: change.to }) as const,
              ),
            ]
            const labels = input.labels
              ? yield* setLabels(transaction, task, input.labels, { canCreate: !actor.agent })
              : []
            const links = yield* editLinks(transaction, task, input.addLinks ?? [], input.removeLinks ?? [])
            const reparented = yield* editParent(transaction, row, parent, input.parentId)
            const events = [...content, ...labels, ...links, ...reparented]
            const fields = new Set(changed.map((change) => change.field))
            const ifChanged = <A>(field: TaskEvent.Field, value: A) => (fields.has(field) ? value : undefined)
            if (events.length > 0)
              yield* transaction
                .update(Database.Schema.task)
                .set({
                  status,
                  title: ifChanged("title", input.title),
                  description: ifChanged("description", input.description),
                  priority: ifChanged("priority", input.priority),
                  due_at: ifChanged("dueAt", dueAt),
                  updated_at: sql`now()`,
                  ...(status && closed.has(status) && { human_review: false, human_review_reason: null }),
                })
                .where(eq(Database.Schema.task.id, id))
            yield* TaskTrail.record(transaction, task, actor, events)
            return yield* reread(transaction, actor, id)
          }),
        )
      }),
      archive: Effect.fn("Task.archive")(function* (actor: Actor.Info, id: Task.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* TaskQueries.lockForWrite(
              transaction,
              access,
              actor,
              eq(Database.Schema.task.id, id),
              actions.archive,
            )
            const subtasks = yield* transaction
              .select({ id: Database.Schema.task.id })
              .from(Database.Schema.task)
              .where(and(eq(Database.Schema.task.parent_id, id), isNull(Database.Schema.task.archived_at)))
              .orderBy(asc(Database.Schema.task.id))
              .for("update")
            yield* transaction
              .update(Database.Schema.task)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(inArray(Database.Schema.task.id, [id, ...subtasks.map((subtask) => subtask.id)]))
            yield* Effect.forEach([{ id }, ...subtasks], (archived) =>
              TaskTrail.record(transaction, { id: archived.id, organizationId: row.task.organization_id }, actor, [
                { _tag: "archived" },
              ]),
            )
            return yield* reread(transaction, actor, id)
          }),
        )
      }),
      assign: Effect.fn("Task.assign")(function* (actor: Actor.Info, id: Task.ID, input: Task.AssignInput) {
        return (yield* handOff(actor, id, input)).task
      }),
      handOff,
      start: Effect.fn("Task.start")(function* (actor: Actor.Info, id: Task.ID, input: Task.StartInput) {
        return yield* launch(actor, id, input.mode).pipe(
          Effect.catchTags({ BrainUnavailable: Effect.die, BrainRejectedError: Effect.die }),
        )
      }),
      review: Effect.fn("Task.review")(function* (actor: Actor.Info, id: Task.ID, input: Task.ReviewInput) {
        if (!input.humanReview && actor.agent)
          return yield* new Primitive.Forbidden({ message: "Only a person decides a review." })
        const decided = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* TaskQueries.lockForWrite(
              transaction,
              access,
              actor,
              eq(Database.Schema.task.id, id),
              actions.review,
            )
            if (!input.humanReview) {
              const review = yield* decide(transaction, row, actor, input)
              return row.task.agent_id ? Option.some(review) : Option.none()
            }
            if (closed.has(row.task.status))
              return yield* new Primitive.Conflict({ message: "A done or dismissed task needs no review." })
            if (row.task.human_review && row.task.human_review_reason === input.reason) return Option.none()
            yield* transaction
              .update(Database.Schema.task)
              .set({ human_review: true, human_review_reason: input.reason, updated_at: sql`now()` })
              .where(eq(Database.Schema.task.id, id))
            yield* TaskTrail.record(transaction, { id, organizationId: row.task.organization_id }, actor, [
              { _tag: "review_requested", reason: input.reason },
            ])
            return Option.none()
          }),
        )
        const start = input.humanReview ? "none" : (input.start ?? reviewStart)
        if (Option.isNone(decided) || start === "none") return yield* read(actor, id)
        return yield* launchAfterCommit(actor, id, "continue", decided.value)
      }),
    })
  }),
)
