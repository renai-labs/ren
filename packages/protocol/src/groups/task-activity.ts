import { TaskActivity } from "@ren/schema/task-activity"
import { Primitive } from "../primitive.js"

export const TaskActivityGroup = Primitive.group(TaskActivity.definition, "sdk", [
  Primitive.list(TaskActivity.definition),
])
