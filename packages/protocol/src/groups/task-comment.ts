import { TaskComment } from "@ren/schema/task-comment"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const TaskCommentGroup = Primitive.group(TaskComment.definition, "sdk", [
  Primitive.create(TaskComment.definition).annotate(Mcp.Tool, true),
  Primitive.update(TaskComment.definition),
  Primitive.archive(TaskComment.definition),
])
