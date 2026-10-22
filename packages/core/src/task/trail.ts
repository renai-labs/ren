export * as TaskTrail from "./trail.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Task } from "@ren/schema/task"
import { TaskEvent } from "@ren/schema/task-event"
import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Actor } from "../actor.js"
import { TaskQueries } from "./queries.js"

export interface Target {
  readonly id: Task.ID
  readonly organizationId: Auth.OrganizationID
}

export const record = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  task: Target,
  actor: Actor.Info,
  events: ReadonlyArray<TaskEvent.Data>,
) {
  if (events.length === 0) return
  const by = TaskQueries.actorOf(actor)
  const encoded = yield* Schema.encodeEffect(Schema.Array(TaskEvent.Data))(events).pipe(Effect.orDie)
  yield* transaction.insert(Database.Schema.task_event).values(
    encoded.map((data) => ({
      id: TaskEvent.ID.create(),
      task_id: task.id,
      organization_id: task.organizationId,
      data,
      actor_user_id: by.userId,
      actor_agent_id: by.agentId,
      actor_session_id: by.sessionId,
      created_at: sql`clock_timestamp()`,
    })),
  )
})
