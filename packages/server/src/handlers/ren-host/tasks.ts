import { Actor } from "@ren/core/actor"
import { Label } from "@ren/core/label"
import type { Primitive } from "@ren/core/primitive"
import { Task } from "@ren/core/task"
import { TaskActivity } from "@ren/core/task/activity"
import { TaskComment } from "@ren/core/task/comment"
import { ForbiddenError, TaskConflictError, TaskInvalidError, TaskNotFoundError } from "@ren/host-api/errors"
import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { Effect, Struct } from "effect"
import { HttpApiBuilder } from "effect/http-api"

const errors = <A, R>(
  effect: Effect.Effect<A, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid, R>,
) =>
  effect.pipe(
    Effect.catchTags({
      "Primitive.NotFound": (error) => Effect.fail(new TaskNotFoundError({ message: error.message })),
      "Primitive.Forbidden": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
      "Primitive.Conflict": (error) => Effect.fail(new TaskConflictError({ message: error.message })),
      "Primitive.Invalid": (error) =>
        Effect.fail(new TaskInvalidError({ message: error.message, ...(error.field && { field: error.field }) })),
    }),
  )

const startMessages: Record<Task.HandOff["start"], string> = {
  none: "",
  started: " The agent is working.",
  failed: " The agent did not start. Ask a person to start it.",
}

export const HostTasksHandler = HttpApiBuilder.group(RenHostApi, "tasks", (handlers) =>
  Effect.gen(function* () {
    const tasks = yield* Task.Service
    const activity = yield* TaskActivity.Service
    const comments = yield* TaskComment.Service
    const labels = yield* Label.Service
    const actors = yield* Actor.Service
    const actor = Effect.flatMap(CurrentHost, actors.fromHost)
    return handlers
      .handle("task_list", (request) =>
        errors(
          Effect.flatMap(actor, (caller) => tasks.list(caller, { ...request.payload, spaceId: caller.agent.spaceId })),
        ),
      )
      .handle("task_get", (request) =>
        errors(
          Effect.gen(function* () {
            const caller = yield* actor
            const task = yield* tasks.get(caller, request.payload.id)
            return {
              task,
              activity: yield* activity.list(caller, {
                taskId: task.id,
                page: request.payload.page,
                pageSize: request.payload.pageSize,
              }),
            }
          }),
        ),
      )
      .handle("task_create", (request) =>
        errors(
          Effect.flatMap(actor, (caller) =>
            tasks.create(caller, { ...request.payload, spaceId: caller.agent.spaceId }),
          ),
        ),
      )
      .handle("task_update", (request) =>
        errors(
          Effect.flatMap(actor, (caller) =>
            tasks.update(caller, request.payload.id, Struct.omit(request.payload, ["id"])),
          ),
        ),
      )
      .handle("task_assign", (request) =>
        errors(
          Effect.gen(function* () {
            const caller = yield* actor
            const handed = yield* tasks.handOff(caller, request.payload.id, Struct.omit(request.payload, ["id"]))
            return { task: handed.task, message: `${handed.task.identifier} assigned.${startMessages[handed.start]}` }
          }),
        ),
      )
      .handle("task_review", (request) =>
        errors(
          Effect.flatMap(actor, (caller) =>
            tasks.review(caller, request.payload.id, { humanReview: true, reason: request.payload.reason }),
          ),
        ),
      )
      .handle("task_comment", (request) =>
        errors(Effect.flatMap(actor, (caller) => comments.create(caller, request.payload))),
      )
      .handle("label_list", (request) =>
        errors(Effect.flatMap(actor, (caller) => labels.list(caller, request.payload))),
      )
  }),
)
