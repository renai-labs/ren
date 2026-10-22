export * as Task from "./task.js"

import { Database } from "@ren/db/database"
import { Label } from "@ren/schema/label"
import { Task } from "@ren/schema/task"
import type { TaskEvent } from "@ren/schema/task-event"
import { TaskLink } from "@ren/schema/task-link"
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Array, Context, DateTime, Effect, Layer, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { TaskPolicy } from "./task/policy.js"
import { TaskQueries } from "./task/queries.js"
import { TaskTrail } from "./task/trail.js"

export type Interface = Omit<Primitive.Interface<typeof Task.definition>, "assign" | "start" | "review">

export class Service extends Context.Service<Service, Interface>()("@ren/core/Task") {}

const actions = {
  list: Primitive.action(Task.definition, "list"),
  create: Primitive.action(Task.definition, "create"),
  update: Primitive.action(Task.definition, "update"),
  archive: Primitive.action(Task.definition, "archive"),
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const reread = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, id: Task.ID) {
      const rows = yield* TaskQueries.select(transaction, actor).where(eq(Database.Schema.task.id, id))
      const info = (yield* TaskQueries.present(transaction, access, actor, rows)).at(0)
      if (!info) return yield* TaskQueries.notFound
      return info
    })

    const refuseClosing = (actor: Actor.Info, status: Task.Status | undefined) =>
      actor.agent && status && closed.has(status)
        ? Effect.fail(new Primitive.Forbidden({ message: "Only a person marks a task done or dismissed." }))
        : Effect.void

    return Service.of({
      list: Effect.fn("Task.list")(function* (actor: Actor.Info, input: Task.ListInput) {
        const linked = input.linkedTo && TaskLink.classify(input.linkedTo)
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
        )
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.list, resource: TaskPolicy.organization }))
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            const rows = yield* TaskQueries.select(transaction, actor)
              .where(where)
              .orderBy(desc(Database.Schema.task.created_at), desc(Database.Schema.task.number))
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
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
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
            const events = [...content, ...labels, ...links]
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
            yield* transaction
              .update(Database.Schema.task)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.task.id, id))
            yield* TaskTrail.record(transaction, { id, organizationId: row.task.organization_id }, actor, [
              { _tag: "archived" },
            ])
            return yield* reread(transaction, actor, id)
          }),
        )
      }),
    })
  }),
)
