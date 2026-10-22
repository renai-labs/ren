import { TaskActivity } from "@ren/core/task/activity"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const TaskActivityHandler = HttpApiBuilder.group(Api, "task-activity", (handlers) =>
  Effect.gen(function* () {
    const activity = yield* TaskActivity.Service
    return handlers.handle("task-activity.list", Primitive.list(activity.list))
  }),
)
