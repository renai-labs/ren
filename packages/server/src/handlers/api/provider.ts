import { ProviderSettings } from "@ren/core/provider-settings"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const retryAfterMs = 5000

const mapFailure = <A>(effect: Effect.Effect<A, ProviderSettings.Failure>) =>
  effect.pipe(
    Effect.catchTags({
      "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
      "Primitive.Forbidden": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
      "Primitive.Invalid": (error) => Effect.fail(new InvalidRequestError({ message: error.message })),
      "InferencePlugin.Unavailable": (error) =>
        Effect.fail(new UnavailableError({ message: error.message, retryAfterMs })),
    }),
  )

export const ProviderHandler = HttpApiBuilder.group(Api, "provider", (handlers) =>
  Effect.gen(function* () {
    const providers = yield* ProviderSettings.Service
    return handlers
      .handle("provider.list", () =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(providers.page(actor))),
      )
      .handle("provider.update", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          mapFailure(providers.update(actor, request.params.id, request.payload)),
        ),
      )
      .handle("provider.test", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          mapFailure(providers.test(actor, request.params.id, request.payload.fields)),
        ),
      )
      .handle("provider.key.save", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          mapFailure(providers.connect(actor, request.params.id, request.payload.fields)),
        ),
      )
      .handle("provider.key.remove", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(providers.disconnect(actor, request.params.id))),
      )
      .handle("provider.models.list", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mapFailure(providers.models(actor, request.params.id))),
      )
      .handle("provider.models.update", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          mapFailure(providers.updateModels(actor, request.params.id, request.payload)),
        ),
      )
  }),
)
