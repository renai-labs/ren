import { Task } from "@ren/core/task"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const TaskHandler = HttpApiBuilder.group(Api, "task", (handlers) =>
  Effect.gen(function* () {
    const tasks = yield* Task.Service
    return handlers
      .handle("task.list", Primitive.list(tasks.list))
      .handle("task.get", Primitive.get(tasks.get))
      .handle("task.create", Primitive.create(tasks.create))
      .handle("task.update", Primitive.update(tasks.update))
      .handle("task.archive", Primitive.archive(tasks.archive))
      .handle("task.assign", Primitive.update(tasks.assign))
      .handle("task.start", Primitive.action(tasks.start))
      .handle("task.review", Primitive.action(tasks.review))
  }),
)
