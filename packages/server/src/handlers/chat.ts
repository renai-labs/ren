import { SessionDirectory } from "@ren/core/session/directory"
import { NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const ChatHandler = HttpApiBuilder.group(Api, "chat", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* SessionDirectory.Service
    return handlers.handle("chat.access", (request) =>
      Effect.flatMap(Primitive.currentActor, (actor) => sessions.access(actor, request.params.id)).pipe(
        Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
      ),
    )
  }),
)
