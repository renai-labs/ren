export * as TaskQueries from "./queries.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import type { TaskLink } from "@ren/schema/task-link"
import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { DateTime, Effect, Option } from "effect"
import { Access } from "../access.js"
import { Actor } from "../actor.js"
import { AgentQueries } from "../agent/queries.js"
import { Primitive } from "../primitive.js"
import { OpenCodeStore } from "../session/opencode-store.js"
import { TaskPolicy } from "./policy.js"

export const notFound = new Primitive.NotFound({ message: "Task not found." })

export const actorOf = (actor: Actor.Info): Task.Actor => ({
  userId: actor.userId,
  agentId: actor.agent?.agentId ?? null,
  sessionId: actor.agent?.sessionId ?? null,
})

export const actions = {
  get: Primitive.action(Task.definition, "get"),
  update: Primitive.action(Task.definition, "update"),
}

export const linking = (organizationId: Auth.OrganizationID, ref: TaskLink.Ref) =>
  and(
    eq(Database.Schema.task.organization_id, organizationId),
    isNull(Database.Schema.task.archived_at),
    inArray(Database.Schema.task.status, Task.actionable),
    sql`exists (
      select 1 from ${Database.Schema.task_link}
      where ${Database.Schema.task_link.task_id} = ${Database.Schema.task.id}
        and ${Database.Schema.task_link.kind} = ${ref.kind}
        and ${Database.Schema.task_link.key} = ${ref.key}
    )`,
  )

export const openByLink = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  ref: TaskLink.Ref,
) {
  const found = yield* transaction
    .select({
      id: Database.Schema.task.id,
      spaceId: Database.Schema.task.space_id,
      agentId: Database.Schema.task.agent_id,
      title: Database.Schema.task.title,
      description: Database.Schema.task.description,
    })
    .from(Database.Schema.task)
    .innerJoin(
      Database.Schema.space,
      and(eq(Database.Schema.space.id, Database.Schema.task.space_id), isNull(Database.Schema.space.archived_at)),
    )
    .where(and(linking(organizationId, ref), isNotNull(Database.Schema.task.agent_id)))
    .limit(2)
  const task = found.length === 1 ? found.at(0) : undefined
  if (!task?.agentId) return Option.none()
  const agent = (yield* transaction
    .select({ id: Database.Schema.agent.id, organizationId: Database.Schema.agent.organization_id })
    .from(Database.Schema.agent)
    .where(and(eq(Database.Schema.agent.id, task.agentId), AgentQueries.isUsableIn(task.spaceId, organizationId)))).at(
    0,
  )
  if (!agent) return Option.none()
  const session = (yield* latestSessions(transaction, [task.id])).at(0)
  return Option.some({
    ...task,
    agentId: agent.id,
    isGlobal: !agent.organizationId,
    ...(session && { sessionId: session.id }),
  })
})

export const membershipOf = (actor: Actor.Info) =>
  and(
    eq(TaskPolicy.membership.space_id, Database.Schema.task.space_id),
    eq(TaskPolicy.membership.user_id, actor.userId),
    isNull(TaskPolicy.membership.archived_at),
    Actor.fenced(actor, TaskPolicy.membership.space_id),
  )

const parent = alias(Database.Schema.task, "parent_task")

export const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({
      task: Database.Schema.task,
      prefix: Database.Schema.task_sequence.prefix,
      membershipId: TaskPolicy.membership.id,
      parent: { id: parent.id, number: parent.number, title: parent.title },
    })
    .from(Database.Schema.task)
    .innerJoin(
      Database.Schema.task_sequence,
      eq(Database.Schema.task_sequence.organization_id, Database.Schema.task.organization_id),
    )
    .leftJoin(TaskPolicy.membership, membershipOf(actor))
    .leftJoin(parent, eq(parent.id, Database.Schema.task.parent_id))

export type Row = Effect.Success<ReturnType<typeof select>>[number]

export const visibleTo = (access: Access.Interface, actor: Actor.Info) =>
  and(
    eq(Database.Schema.task.organization_id, actor.organizationId),
    isNull(Database.Schema.task.archived_at),
    Access.where(access.plan(actor, actions.get), TaskPolicy.where),
  )

const allowedOne = (access: Access.Interface, actor: Actor.Info, action: string) =>
  Effect.fnUntraced(function* (rows: ReadonlyArray<Row>) {
    const row = rows.at(0)
    if (!row) return yield* notFound
    if (!access.isAllowed({ actor, action, resource: TaskPolicy.resource(row.membershipId) }))
      return yield* new Primitive.Forbidden({ message: "You cannot change this task." })
    return row
  })

export const find = (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  where: SQL,
  action: string,
) =>
  select(transaction, actor)
    .where(and(where, visibleTo(access, actor)))
    .pipe(Effect.flatMap(allowedOne(access, actor, action)))

export const lockForWrite = (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  where: SQL,
  action: string,
) =>
  select(transaction, actor)
    .where(and(where, visibleTo(access, actor)))
    .for("update", { of: Database.Schema.task })
    .pipe(Effect.flatMap(allowedOne(access, actor, action)))

export const lockParent = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  parentId: Task.ID | null | undefined,
) {
  if (!parentId) return
  const row = yield* lockForWrite(
    transaction,
    access,
    actor,
    eq(Database.Schema.task.id, parentId),
    actions.update,
  ).pipe(
    Effect.catchTag("Primitive.NotFound", () =>
      Effect.fail(new Primitive.Invalid({ message: "The parent task was not found.", field: "parentId" })),
    ),
  )
  if (row.task.parent_id)
    return yield* new Primitive.Invalid({ message: "A subtask cannot have subtasks.", field: "parentId" })
  return row
})

export const byParent = (parentId: Task.ListInput["parentId"]) => {
  if (parentId === "none") return { where: isNull(Database.Schema.task.parent_id), order: desc }
  if (parentId) return { where: eq(Database.Schema.task.parent_id, parentId), order: asc }
  return { where: undefined, order: desc }
}

export const latestSessions = (transaction: Database.Transaction, taskIds: ReadonlyArray<Task.ID>) =>
  transaction
    .selectDistinctOn([Database.Schema.task_session.task_id], {
      taskId: Database.Schema.task_session.task_id,
      id: Database.Schema.task_session.session_id,
      synced: Database.Schema.opencode_session.session_id,
      suspended: Database.Schema.opencode_session.time_suspended,
      outcome: Database.Schema.opencode_session.idle_outcome,
    })
    .from(Database.Schema.task_session)
    .innerJoin(Database.Schema.task, eq(Database.Schema.task.id, Database.Schema.task_session.task_id))
    .innerJoin(
      Database.Schema.agent_session,
      eq(Database.Schema.agent_session.id, Database.Schema.task_session.session_id),
    )
    .leftJoin(Database.Schema.opencode_session, OpenCodeStore.join)
    .where(
      and(
        inArray(Database.Schema.task_session.task_id, taskIds),
        eq(Database.Schema.task_session.agent_id, Database.Schema.task.agent_id),
        eq(Database.Schema.agent_session.space_id, Database.Schema.task.space_id),
        isNull(Database.Schema.agent_session.archived_at),
      ),
    )
    .orderBy(
      Database.Schema.task_session.task_id,
      desc(Database.Schema.task_session.created_at),
      desc(Database.Schema.task_session.session_id),
    )

type Latest = Effect.Success<ReturnType<typeof latestSessions>>[number]

const stateOf = (session: Latest): Task.SessionState => {
  if (session.suspended || !session.synced) return "working"
  return session.outcome === "failed" ? "failed" : "idle"
}

export const present = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  rows: ReadonlyArray<Row>,
) {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.task.id)
  const labels = yield* transaction
    .select({
      taskId: Database.Schema.task_label.task_id,
      id: Database.Schema.label.id,
      name: Database.Schema.label.name,
      color: Database.Schema.label.color,
      organizationId: Database.Schema.label.organization_id,
    })
    .from(Database.Schema.task_label)
    .innerJoin(Database.Schema.label, eq(Database.Schema.label.id, Database.Schema.task_label.label_id))
    .where(inArray(Database.Schema.task_label.task_id, ids))
    .orderBy(sql`lower(${Database.Schema.label.name})`, asc(Database.Schema.label.id))
  const links = yield* transaction
    .select()
    .from(Database.Schema.task_link)
    .where(inArray(Database.Schema.task_link.task_id, ids))
    .orderBy(asc(Database.Schema.task_link.created_at), asc(Database.Schema.task_link.id))
  const subtasks = new Map(
    (yield* transaction
      .select({
        parentId: Database.Schema.task.parent_id,
        total: sql<number>`count(*) filter (where ${Database.Schema.task.status} <> 'dismissed')`.mapWith(Number),
        done: sql<number>`count(*) filter (where ${Database.Schema.task.status} = 'done')`.mapWith(Number),
      })
      .from(Database.Schema.task)
      .where(and(inArray(Database.Schema.task.parent_id, ids), isNull(Database.Schema.task.archived_at)))
      .groupBy(Database.Schema.task.parent_id)).map((counts) => [counts.parentId, counts]),
  )
  const labelsOf = Map.groupBy(labels, (label) => label.taskId)
  const linksOf = Map.groupBy(links, (link) => link.task_id)
  const sessions = new Map(
    (yield* latestSessions(transaction, ids)).map((session) => [
      session.taskId,
      { id: session.id, state: stateOf(session) },
    ]),
  )
  return rows.map((row): Task.Info => {
    const counts = subtasks.get(row.task.id)
    return {
      id: row.task.id,
      organizationId: row.task.organization_id,
      spaceId: row.task.space_id,
      parentId: row.task.parent_id,
      parent: row.parent && {
        id: row.parent.id,
        identifier: `${row.prefix}-${row.parent.number}`,
        title: row.parent.title,
      },
      subtasks: counts ? { total: counts.total, done: counts.done } : null,
      number: row.task.number,
      identifier: `${row.prefix}-${row.task.number}`,
      title: row.task.title,
      description: row.task.description,
      status: row.task.status,
      priority: row.task.priority,
      humanReview: row.task.human_review,
      humanReviewReason: row.task.human_review_reason,
      dueAt: row.task.due_at && DateTime.fromDateUnsafe(row.task.due_at),
      agentId: row.task.agent_id,
      ownerId: row.task.owner_id,
      session: sessions.get(row.task.id) ?? null,
      labels: (labelsOf.get(row.task.id) ?? []).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        isSystem: !label.organizationId,
      })),
      links: (linksOf.get(row.task.id) ?? []).map((link) => ({ id: link.id, kind: link.kind, url: link.url })),
      createdBy: {
        userId: row.task.created_by_user_id,
        agentId: row.task.created_by_agent_id,
        sessionId: row.task.created_by_session_id,
      },
      canUpdate: access.isAllowed({
        actor,
        action: actions.update,
        resource: TaskPolicy.resource(row.membershipId),
      }),
      createdAt: DateTime.fromDateUnsafe(row.task.created_at),
      updatedAt: DateTime.fromDateUnsafe(row.task.updated_at),
      archivedAt: row.task.archived_at && DateTime.fromDateUnsafe(row.task.archived_at),
    }
  })
})

export const writableSpace = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  spaceId: Space.ID,
  action: string,
) {
  const space = yield* AgentQueries.visibleSpace(transaction, actor, spaceId)
  if (!access.isAllowed({ actor, action, resource: TaskPolicy.resource(space.membershipId) }))
    return yield* new Primitive.Forbidden({ message: "You cannot change tasks in this space." })
})

export const checkAssignment = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
  assignment: { readonly agentId?: Agent.ID | null | undefined; readonly ownerId?: Auth.UserID | null | undefined },
) {
  const agents = assignment.agentId
    ? yield* transaction
        .select({ id: Database.Schema.agent.id })
        .from(Database.Schema.agent)
        .where(and(eq(Database.Schema.agent.id, assignment.agentId), AgentQueries.isUsableIn(spaceId, organizationId)))
        .for("share")
    : undefined
  if (agents?.length === 0)
    return yield* new Primitive.Invalid({ message: "This agent is not available in the space.", field: "agentId" })
  if (assignment.ownerId && !(yield* AgentQueries.isMember(transaction, spaceId, assignment.ownerId)))
    return yield* new Primitive.Invalid({ message: "The owner must be a member of the space.", field: "ownerId" })
})
