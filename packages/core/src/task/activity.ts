export * as TaskActivity from "./activity.js"

import { Database } from "@ren/db/database"
import { TaskActivity } from "@ren/schema/task-activity"
import { TaskEvent } from "@ren/schema/task-event"
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { TaskComment } from "./comment.js"
import { TaskPolicy } from "./policy.js"
import { TaskQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof TaskActivity.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/TaskActivity") {}

const list = Primitive.action(TaskActivity.definition, "list")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    return Service.of({
      list: Effect.fn("TaskActivity.list")(function* (actor: Actor.Info, input: TaskActivity.ListInput) {
        const empty = { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const task = (yield* TaskQueries.select(transaction, actor).where(
              and(eq(Database.Schema.task.id, input.taskId), TaskQueries.visibleTo(access, actor)),
            )).at(0)
            if (
              !task ||
              !access.isAllowed({
                actor,
                action: list,
                resource: TaskPolicy.resource(task.membershipId),
              })
            )
              return empty
            const ofEvents = eq(Database.Schema.task_event.task_id, input.taskId)
            const ofComments = and(
              eq(Database.Schema.task_comment.task_id, input.taskId),
              isNull(Database.Schema.task_comment.archived_at),
            )
            const ids = yield* transaction
              .select({
                id: sql<string>`${Database.Schema.task_event.id}`.as("id"),
                createdAt: sql<Date>`${Database.Schema.task_event.created_at}`.as("created_at"),
              })
              .from(Database.Schema.task_event)
              .where(ofEvents)
              .unionAll(
                transaction
                  .select({
                    id: sql<string>`${Database.Schema.task_comment.id}`.as("id"),
                    createdAt: sql<Date>`${Database.Schema.task_comment.created_at}`.as("created_at"),
                  })
                  .from(Database.Schema.task_comment)
                  .where(ofComments),
              )
              .orderBy(sql`"created_at"`, sql`"id"`)
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const eventIds = ids.map((row) => row.id).filter(Schema.is(TaskEvent.ID))
            const events = yield* transaction
              .select()
              .from(Database.Schema.task_event)
              .where(inArray(Database.Schema.task_event.id, eventIds))
            const comments = yield* transaction
              .select()
              .from(Database.Schema.task_comment)
              .where(
                inArray(Database.Schema.task_comment.id, ids.map((row) => row.id).filter(Schema.is(TaskComment.ID))),
              )
            const decoded = yield* Effect.forEach(events, (row) =>
              Schema.decodeUnknownEffect(TaskEvent.Data)(row.data).pipe(
                Effect.orDie,
                Effect.map((data): TaskActivity.Info => ({
                  id: row.id,
                  type: "event",
                  event: {
                    id: row.id,
                    taskId: row.task_id,
                    data,
                    actor: {
                      userId: row.actor_user_id,
                      agentId: row.actor_agent_id,
                      sessionId: row.actor_session_id,
                    },
                    createdAt: DateTime.fromDateUnsafe(row.created_at),
                  },
                })),
              ),
            )
            const items = new Map<string, TaskActivity.Info>(
              [
                ...decoded,
                ...comments.map((row): TaskActivity.Info => ({
                  id: row.id,
                  type: "comment",
                  comment: TaskComment.toInfo(access, actor, task.membershipId)(row),
                })),
              ].map((item) => [item.id, item]),
            )
            const totals = yield* Effect.all([
              transaction.select({ total: count() }).from(Database.Schema.task_event).where(ofEvents),
              transaction.select({ total: count() }).from(Database.Schema.task_comment).where(ofComments),
            ])
            return {
              items: ids.flatMap((row) => items.get(row.id) ?? []),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.reduce((sum, rows) => sum + (rows.at(0)?.total ?? 0), 0),
            }
          }),
        )
      }),
    })
  }),
)
