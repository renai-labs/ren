import { Task } from "@ren/schema/task"
import { Primitive } from "../primitive.js"

export const TaskGroup = Primitive.group(Task.definition, "sdk", [
  Primitive.list(Task.definition),
  Primitive.get(Task.definition),
  Primitive.create(Task.definition),
  Primitive.update(Task.definition),
  Primitive.archive(Task.definition),
  Primitive.action(Task.definition, "assign", { invalid: true }),
  Primitive.action(Task.definition, "start"),
  Primitive.action(Task.definition, "review"),
])
