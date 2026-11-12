import { LinkPreview } from "@ren/core/link-preview"
import { Session } from "@ren/core/session"
import { Task } from "@ren/core/task"
import { NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const LinkHandler = HttpApiBuilder.group(Api, "link", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const tasks = yield* Task.Service
    const previews = yield* LinkPreview.Service
    return handlers
      .handle("session.links", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.links(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("session.pullRequests", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.pullRequests(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("session.linkPreviews", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          previews.read(actor, request.params.id, request.payload.urls),
        ).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("task.pullRequests", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => tasks.pullRequests(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
  }),
)
