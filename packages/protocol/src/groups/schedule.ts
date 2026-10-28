import { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Primitive } from "../primitive.js"

export const ScheduleGroup = Primitive.group(Schedule.definition, "sdk", [
  Primitive.list(Schedule.definition),
  Primitive.get(Schedule.definition),
  Primitive.create(Schedule.definition),
  Primitive.update(Schedule.definition),
  Primitive.archive(Schedule.definition),
  Primitive.action(Schedule.definition, "pause"),
  Primitive.action(Schedule.definition, "resume"),
  Primitive.action(Schedule.definition, "run"),
])

export const ScheduleRunGroup = Primitive.group(ScheduleRun.definition, "sdk", [Primitive.list(ScheduleRun.definition)])
