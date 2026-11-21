import { RenInference } from "@ren/core/ren-inference"
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  UnavailableError,
} from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
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
      "Primitive.Conflict": (error) => Effect.fail(new ConflictError({ message: error.message })),
      "RenInference.Unavailable": (error) =>
        Effect.fail(new UnavailableError({ message: error.message, retryAfterMs })),
    }),
  )

const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, "cache-control", "no-store")),
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
      .handle("ren-inference.key.list", () =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.keys(actor))),
      )
      .handle("ren-inference.key.usage", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.keyUsage(actor, request.query.period))),
      )
      .handle("ren-inference.key.create", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          Effect.andThen(noStore, mapFailure(inference.createKey(actor, request.payload))),
        ),
      )
      .handle("ren-inference.key.revoke", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.revokeKey(actor, request.params.id))),
      )
      .handle("ren-inference.key.secret", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          Effect.andThen(noStore, mapFailure(inference.keySecret(actor, request.params.id))),
        ),
      )
      .handle("ren-inference.harness-plan", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(inference.harnessPlan(actor, request.payload))),
      )
  }),
)
