import { Session } from "@ren/core/session"
import { InvalidRequestError, NotFoundError, TooLargeError, UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ChatHandler = HttpApiBuilder.group(Api, "chat", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return handlers
      .handle("chat.access", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          sessions.access(actor, request.params.id, { unreachable: request.query.unreachable === "true" }),
        ).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("chat.messages", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          sessions.messages(actor, request.params.id, request.query),
        ).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
            "Primitive.Invalid": (error) =>
              Effect.fail(
                new InvalidRequestError({ message: error.message, ...(error.field && { field: error.field }) }),
              ),
            "Session.PageTooLarge": (error) => Effect.fail(new TooLargeError({ message: error.message })),
            "Session.Busy": (error) =>
              Effect.fail(new UnavailableError({ message: error.message, retryAfterMs: 2000 })),
          }),
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
