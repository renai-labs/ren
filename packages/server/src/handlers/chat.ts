import { SessionDirectory } from "@ren/core/session/directory"
import { ConflictError, NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const ChatHandler = HttpApiBuilder.group(Api, "chat", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* SessionDirectory.Service
    return handlers
      .handle("chat.access", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.access(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("chat.models", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.models(actor, request.params.id)),
      )
      .handle("chat.fork", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          sessions.fork(actor, request.params.sessionId, request.payload),
        ).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
            "Primitive.Conflict": (error) => Effect.fail(new ConflictError({ message: error.message })),
          }),
        ),
      )
      .handle("chat.read", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => sessions.markRead(actor, request.params.sessionId)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
  }),
)
