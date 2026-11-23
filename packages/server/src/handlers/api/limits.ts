import { Limits } from "@ren/core/limits"
import { NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const LimitsHandler = HttpApiBuilder.group(Api, "limits", (handlers) =>
  Effect.gen(function* () {
    const limits = yield* Limits.Service
    return handlers.handle("limits.get", (request) =>
      Effect.flatMap(Primitive.currentActor, (actor) => limits.get(actor, request.params.id)).pipe(
        Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
      ),
    )
  }),
)
