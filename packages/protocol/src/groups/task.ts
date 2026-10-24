import { Task } from "@ren/schema/task"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const TaskGroup = Primitive.group(Task.definition, "sdk", [
  Primitive.list(Task.definition).annotate(Mcp.Tool, true),
  Primitive.get(Task.definition).annotate(Mcp.Tool, true),
  Primitive.create(Task.definition).annotate(Mcp.Tool, true),
  Primitive.update(Task.definition).annotate(Mcp.Tool, true),
  Primitive.archive(Task.definition),
  Primitive.action(Task.definition, "assign", { invalid: true }).annotate(Mcp.Tool, true),
  Primitive.action(Task.definition, "start").annotate(Mcp.Tool, true),
  Primitive.action(Task.definition, "review").annotate(Mcp.Tool, true),
])
