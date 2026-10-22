import { TaskComment } from "@ren/schema/task-comment"
import { Primitive } from "../primitive.js"

export const TaskCommentGroup = Primitive.group(TaskComment.definition, "sdk", [
  Primitive.create(TaskComment.definition),
  Primitive.update(TaskComment.definition),
  Primitive.archive(TaskComment.definition),
])
