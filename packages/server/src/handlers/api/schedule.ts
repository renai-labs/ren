import { Schedules } from "@ren/core/schedules"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ScheduleHandler = HttpApiBuilder.group(Api, "schedule", (handlers) =>
  Effect.gen(function* () {
    const schedules = yield* Schedules.Service
    return handlers
      .handle("schedule.list", Primitive.list(schedules.list))
      .handle("schedule.get", Primitive.get(schedules.get))
      .handle("schedule.create", Primitive.create(schedules.create))
      .handle("schedule.update", Primitive.update(schedules.update))
      .handle("schedule.archive", Primitive.archive(schedules.archive))
      .handle("schedule.pause", Primitive.action(schedules.pause))
      .handle("schedule.resume", Primitive.action(schedules.resume))
      .handle("schedule.run", Primitive.action(schedules.run))
  }),
)

export const ScheduleRunHandler = HttpApiBuilder.group(Api, "schedule-run", (handlers) =>
  Effect.gen(function* () {
    const schedules = yield* Schedules.Service
    return handlers.handle("schedule-run.list", Primitive.list(schedules.runs))
  }),
)
