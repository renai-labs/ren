import { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const ScheduleGroup = Primitive.group(Schedule.definition, "sdk", [
  Primitive.list(Schedule.definition).annotate(Mcp.Tool, true),
  Primitive.get(Schedule.definition).annotate(Mcp.Tool, true),
  Primitive.create(Schedule.definition).annotate(Mcp.Tool, true),
  Primitive.update(Schedule.definition).annotate(Mcp.Tool, true),
  Primitive.archive(Schedule.definition).annotate(Mcp.Tool, true),
  Primitive.action(Schedule.definition, "pause").annotate(Mcp.Tool, true),
  Primitive.action(Schedule.definition, "resume").annotate(Mcp.Tool, true),
  Primitive.action(Schedule.definition, "run").annotate(Mcp.Tool, true),
])

export const ScheduleRunGroup = Primitive.group(ScheduleRun.definition, "sdk", [
  Primitive.list(ScheduleRun.definition).annotate(Mcp.Tool, true),
])
