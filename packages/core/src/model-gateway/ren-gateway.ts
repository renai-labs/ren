export * as RenGateway from "./ren-gateway.js"

import { Config, Context, Effect, Layer, Option, PubSub, Stream } from "effect"
import { ModelGateway } from "../model-gateway.js"
import { RenInference } from "../ren-inference.js"

export const id = "ren-gateway"

// oxlint-disable-next-line ren/no-comments -- Providers §6.2: what the gateway says changed (`POST /internal/inference/changed`). The server's handler publishes; the gateway's `changed` reads.
export class Changes extends Context.Service<Changes, PubSub.PubSub<ModelGateway.Changed>>()(
  "@ren/core/RenGateway/Changes",
) {}

export const layerChanges = Layer.effect(Changes, PubSub.unbounded<ModelGateway.Changed>())

export const configured = Effect.map(Config.option(Config.String("REN_INFERENCE_URL")), Option.isSome)

const trimmed = (url: string) => url.replace(/\/+$/u, "")

const unavailable = (cause: RenInference.Failure) => new ModelGateway.Unavailable({ message: cause.message, cause })

// oxlint-disable-next-line ren/no-comments -- A 400 from the gateway is the vendor's message or a field it does not take: the person can fix it.
const rejectedOr = (cause: RenInference.Failure) =>
  cause._tag === "Primitive.Invalid" ? new ModelGateway.Rejected({ message: cause.message }) : unavailable(cause)

// oxlint-disable-next-line ren/no-comments -- Providers §6.2: the gateway's providers and models through the Ren Inference Service; brains call its LiteLLM (`REN_INFERENCE_BRAIN_URL`) with a key it mints per brain.
export const gateway = Effect.gen(function* () {
  const root = trimmed(yield* Config.String("REN_INFERENCE_URL"))
  const brainRoot = trimmed(
    yield* Config.String("REN_INFERENCE_BRAIN_URL").pipe(
      Config.orElse(() => Config.String("REN_INFERENCE_GATEWAY_URL")),
      Config.withDefault(root),
    ),
  )
  const inference = yield* RenInference.Service
  const changes = yield* Changes
  return {
    id,
    baseUrl: `${brainRoot}/v1`,
    headers: {},
    providers: inference.providers.pipe(Effect.mapError(unavailable)),
    models: (provider, organizationId) => inference.models(provider, organizationId).pipe(Effect.mapError(unavailable)),
    changed: Stream.fromPubSub(changes),
    organizations: (provider) => inference.organizations(provider).pipe(Effect.mapError(unavailable)),
    grant: (input) =>
      inference.grant(input.brainId, input.organizationId, input.spaceId).pipe(
        Effect.mapError(unavailable),
        Effect.map((key): ModelGateway.Grant =>
          key.expiresAt ? { _tag: "Minted", key: key.key, expiresAt: key.expiresAt } : { _tag: "Fixed", key: key.key },
        ),
      ),
    settings: (organizationId) => inference.providerSettings(organizationId).pipe(Effect.mapError(unavailable)),
    update: (provider, organizationId, change) =>
      inference.updateProvider(organizationId, provider, change).pipe(Effect.mapError(unavailable)),
    switchModels: (provider, organizationId, models) =>
      inference.switchModels(organizationId, provider, models).pipe(Effect.mapError(unavailable)),
    test: (provider, organizationId, fields) =>
      inference.testKey(organizationId, provider, fields).pipe(Effect.mapError(rejectedOr)),
    connect: (provider, organizationId, fields, savedBy) =>
      inference.saveKey(organizationId, provider, fields, savedBy).pipe(Effect.mapError(rejectedOr)),
    disconnect: (provider, organizationId) =>
      inference.removeKey(organizationId, provider).pipe(Effect.mapError(unavailable)),
    limits: (provider, organizationId, query) =>
      inference.limits(organizationId, provider, query).pipe(Effect.mapError(unavailable)),
  } satisfies ModelGateway.Gateway
})
