export * as TaskComment from "./comment.js"

import { Database } from "@ren/db/database"
import { TaskComment } from "@ren/schema/task-comment"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { TaskPolicy } from "./policy.js"
import { TaskQueries } from "./queries.js"

export { ID } from "@ren/schema/task-comment"

export type Interface = Primitive.Interface<typeof TaskComment.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/TaskComment") {}

const notFound = new Primitive.NotFound({ message: "Comment not found." })

const actions = {
  create: Primitive.action(TaskComment.definition, "create"),
  update: Primitive.action(TaskComment.definition, "update"),
  archive: Primitive.action(TaskComment.definition, "archive"),
}

type Row = typeof Database.Schema.task_comment.$inferSelect

// oxlint-disable-next-line ren/no-comments -- An agent acts as its sender (AC17).
const isAuthor = (actor: Actor.Info, row: Row) => row.author_user_id === actor.userId

export const toInfo =
  (access: Access.Interface, actor: Actor.Info, membershipId: string | null) =>
  (row: Row): TaskComment.Info => ({
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    author: { userId: row.author_user_id, agentId: row.author_agent_id, sessionId: row.author_session_id },
    editedAt: row.edited_at && DateTime.fromDateUnsafe(row.edited_at),
    canUpdate: access.isAllowed({
      actor,
      action: Primitive.action(TaskComment.definition, "update"),
      resource: TaskPolicy.comment(membershipId, { isAuthor: isAuthor(actor, row) }),
    }),
    createdAt: DateTime.fromDateUnsafe(row.created_at),
    updatedAt: DateTime.fromDateUnsafe(row.updated_at),
    archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const findOwn = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: TaskComment.ID,
      action: string,
    ) {
      const row = (yield* transaction
        .select()
        .from(Database.Schema.task_comment)
        .where(and(eq(Database.Schema.task_comment.id, id), isNull(Database.Schema.task_comment.archived_at)))
        .for("update")).at(0)
      if (!row) return yield* notFound
      const task = yield* TaskQueries.find(
        transaction,
        access,
        actor,
        eq(Database.Schema.task.id, row.task_id),
        TaskQueries.actions.get,
      ).pipe(Effect.catchTag("Primitive.NotFound", () => Effect.fail(notFound)))
      if (
        !access.isAllowed({
          actor,
          action,
          resource: TaskPolicy.comment(task.membershipId, { isAuthor: isAuthor(actor, row) }),
        })
      )
        return yield* new Primitive.Forbidden({ message: "Only the author can change a comment." })
      return { row, membershipId: task.membershipId }
    })

    const written = (rows: ReadonlyArray<Row>) => {
      const row = rows.at(0)
      return row ? Effect.succeed(row) : Effect.fail(notFound)
    }

    return Service.of({
      create: Effect.fn("TaskComment.create")(function* (actor: Actor.Info, input: TaskComment.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const task = yield* TaskQueries.find(
              transaction,
              access,
              actor,
              eq(Database.Schema.task.id, input.taskId),
              actions.create,
            )
            const by = TaskQueries.actorOf(actor)
            const rows = yield* transaction
              .insert(Database.Schema.task_comment)
              .values({
                id: TaskComment.ID.create(),
                task_id: input.taskId,
                body: input.body,
                author_user_id: by.userId,
                author_agent_id: by.agentId,
                author_session_id: by.sessionId,
                created_at: sql`clock_timestamp()`,
              })
              .returning()
            return toInfo(access, actor, task.membershipId)(yield* written(rows))
          }),
        )
      }),
      update: Effect.fn("TaskComment.update")(function* (
        actor: Actor.Info,
        id: TaskComment.ID,
        input: TaskComment.UpdateInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findOwn(transaction, actor, id, actions.update)
            const info = toInfo(access, actor, found.membershipId)
            if (found.row.body === input.body) return info(found.row)
            const rows = yield* transaction
              .update(Database.Schema.task_comment)
              .set({ body: input.body, edited_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.task_comment.id, id))
              .returning()
            return info(yield* written(rows))
          }),
        )
      }),
      archive: Effect.fn("TaskComment.archive")(function* (actor: Actor.Info, id: TaskComment.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findOwn(transaction, actor, id, actions.archive)
            const rows = yield* transaction
              .update(Database.Schema.task_comment)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.task_comment.id, id))
              .returning()
            return toInfo(access, actor, found.membershipId)(yield* written(rows))
          }),
        )
      }),
    })
  }),
)
