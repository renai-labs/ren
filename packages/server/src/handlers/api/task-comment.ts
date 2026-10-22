import { TaskComment } from "@ren/core/task/comment"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const TaskCommentHandler = HttpApiBuilder.group(Api, "task-comment", (handlers) =>
  Effect.gen(function* () {
    const comments = yield* TaskComment.Service
    return handlers
      .handle("task-comment.create", Primitive.create(comments.create))
      .handle("task-comment.update", Primitive.update(comments.update))
      .handle("task-comment.archive", Primitive.archive(comments.archive))
  }),
)
