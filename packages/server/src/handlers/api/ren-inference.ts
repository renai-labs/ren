import { RenInference } from "@ren/core/ren-inference"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const retryAfterMs = 5000

const mapFailure = <A>(effect: Effect.Effect<A, RenInference.Failure>) =>
  effect.pipe(
    Effect.catchTags({
      "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
      "Primitive.Forbidden": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
      "Primitive.Invalid": (error) => Effect.fail(new InvalidRequestError({ message: error.message })),
      "RenInference.Unavailable": (error) =>
        Effect.fail(new UnavailableError({ message: error.message, retryAfterMs })),
    }),
  )

export const RenInferenceHandler = HttpApiBuilder.group(Api, "ren-inference", (handlers) =>
  Effect.gen(function* () {
    const inference = yield* RenInference.Service
    return handlers
      .handle("ren-inference.connect", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.connect(actor, request.payload))),
      )
      .handle("ren-inference.connection.list", () =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.list(actor))),
      )
      .handle("ren-inference.connection.rename", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          mapFailure(inference.rename(actor, request.params.id, request.payload)),
        ),
      )
      .handle("ren-inference.connection.remove", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.remove(actor, request.params.id))),
      )
  }),
)
