import { Session } from "@ren/core/session"
import { NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ChatHandler = HttpApiBuilder.group(Api, "chat", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return handlers
      .handle("chat.access", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.access(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("chat.retry", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          sessions.retry(actor, request.params.id, request.payload.message),
        ).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("chat.prepare", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.prepare(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("chat.models", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.models(actor, request.params.id)),
      )
  }),
)
