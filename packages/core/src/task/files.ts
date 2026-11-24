export * as TaskFiles from "./files.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Drive } from "@ren/schema/drive"
import { Space } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { DurableRunner } from "../durable-runner.js"
import { Drives } from "../drives.js"

export interface Moved {
  readonly organizationId: Auth.OrganizationID
  readonly taskId: Task.ID
  readonly fromSpaceId: Space.ID
}

export interface Interface {
  readonly moved: (input: Moved) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/TaskFiles") {}

// oxlint-disable-next-line ren/no-comments -- One durable run per move of a task to another space. moveId keys each move, so a task that moves back and forth runs again.
const MoveRun = DurableRunner.make("TaskFilesMove", {
  payload: { organizationId: Auth.OrganizationID, taskId: Task.ID, fromSpaceId: Space.ID, moveId: Schema.String },
  idempotencyKey: (payload) => `task-files-move:${payload.taskId}:${payload.moveId}`,
})

// oxlint-disable-next-line ren/no-comments -- Moves the task's folder to the space the task is in now, not to the one of this move, so runs of moves in a row that end out of order still leave it there.
export const settle = Effect.fnUntraced(function* (
  database: Database.Interface,
  drives: Drives.Interface,
  input: Moved,
) {
  const rows = yield* database.db
    .select({
      spaceId: Database.Schema.task.space_id,
      number: Database.Schema.task.number,
      prefix: Database.Schema.task_sequence.prefix,
    })
    .from(Database.Schema.task)
    .innerJoin(
      Database.Schema.task_sequence,
      eq(Database.Schema.task_sequence.organization_id, Database.Schema.task.organization_id),
    )
    .where(eq(Database.Schema.task.id, input.taskId))
    .pipe(Effect.orDie)
  const row = rows.at(0)
  if (!row || row.spaceId === input.fromSpaceId) return
  yield* drives.move(
    { organizationId: input.organizationId, spaceId: input.fromSpaceId },
    { organizationId: input.organizationId, spaceId: row.spaceId },
    Drive.taskFolder(`${row.prefix}-${row.number}`),
  )
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const drives = yield* Drives.Service
    const move = yield* DurableRunner.supervised(MoveRun, (payload) => settle(database, drives, payload))
    return Service.of({
      moved: Effect.fn("TaskFiles.moved")(function* (input) {
        yield* move({ ...input, moveId: crypto.randomUUID() })
      }),
    })
  }),
)

export const layerNone = Layer.succeed(Service, Service.of({ moved: () => Effect.void }))
