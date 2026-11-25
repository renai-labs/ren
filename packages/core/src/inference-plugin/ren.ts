export * as RenInferencePlugin from "./ren.js"

import { Config, Effect, Option } from "effect"
import { InferencePlugin } from "../inference-plugin.js"
import { RenInference } from "../ren-inference.js"

export const id = "ren-inference"

export const configured = Effect.map(Config.option(Config.String("REN_INFERENCE_URL")), Option.isSome)

const trimmed = (url: string) => url.replace(/\/+$/u, "")

const unavailable = (cause: RenInference.Failure) => new InferencePlugin.Unavailable({ message: cause.message, cause })

// oxlint-disable-next-line ren/no-comments -- A 4xx from the inference service (the vendor's message, a field it does not take, a provider it does not offer) is final for this request: the person sees it, and no retry changes it.
const rejectedOr = (cause: RenInference.Failure) =>
  cause._tag === "Primitive.Invalid" ||
  cause._tag === "Primitive.NotFound" ||
  cause._tag === "Primitive.Forbidden" ||
  cause._tag === "Primitive.Conflict"
    ? new InferencePlugin.Rejected({ message: cause.message })
    : unavailable(cause)

// oxlint-disable-next-line ren/no-comments -- Providers §6.2: the inference service's providers and models through the Ren Inference Service; brains call its LiteLLM (`REN_INFERENCE_BRAIN_URL`) with a key it mints per brain.
export const plugin = Effect.gen(function* () {
  const root = trimmed(yield* Config.String("REN_INFERENCE_URL"))
  const brainRoot = trimmed(
    yield* Config.String("REN_INFERENCE_BRAIN_URL").pipe(
      Config.orElse(() => Config.String("REN_INFERENCE_GATEWAY_URL")),
      Config.withDefault(root),
    ),
  )
  const inference = yield* RenInference.Service
  return {
    id,
    baseUrl: `${brainRoot}/v1`,
    headers: {},
    providers: inference.providers.pipe(Effect.mapError(unavailable)),
    models: (provider, organizationId) => inference.models(provider, organizationId).pipe(Effect.mapError(unavailable)),
    grant: (input) =>
      inference.grant(input.brainId, input.organizationId, input.spaceId).pipe(
        Effect.mapError(unavailable),
        Effect.map((key): InferencePlugin.Grant =>
          key.expiresAt ? { _tag: "Minted", key: key.key, expiresAt: key.expiresAt } : { _tag: "Fixed", key: key.key },
        ),
      ),
    settings: (organizationId) => inference.providerSettings(organizationId).pipe(Effect.mapError(unavailable)),
    update: (provider, organizationId, change) =>
      inference.updateProvider(organizationId, provider, change).pipe(Effect.mapError(rejectedOr)),
    switchModels: (provider, organizationId, models) =>
      inference.switchModels(organizationId, provider, models).pipe(Effect.mapError(rejectedOr)),
    test: (provider, organizationId, fields) =>
      inference.testKey(organizationId, provider, fields).pipe(Effect.mapError(rejectedOr)),
    saveKey: (provider, organizationId, fields, savedBy) =>
      inference.saveKey(organizationId, provider, fields, savedBy).pipe(Effect.mapError(rejectedOr)),
    removeKey: (provider, organizationId) =>
      inference.removeKey(organizationId, provider).pipe(Effect.mapError(rejectedOr)),
    limits: (provider, organizationId, query) =>
      inference.limits(organizationId, provider, query).pipe(Effect.mapError(unavailable)),
  } satisfies InferencePlugin.Plugin
})
