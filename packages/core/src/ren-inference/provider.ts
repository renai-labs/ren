export * as RenInferenceProvider from "./provider.js"

import { Config, DateTime, Duration, Effect, Option } from "effect"
import { Models } from "../models.js"
import { RenInference } from "../ren-inference.js"

export const keyLifetime = Duration.hours(6)

const trimmed = (url: string) => url.replace(/\/+$/u, "")

export const configured = Effect.map(
  Config.all([
    Config.option(Config.String("REN_INFERENCE_URL")),
    Config.option(Config.String("REN_INFERENCE_GATEWAY_URL")),
  ]),
  (found) => found.some(Option.isSome),
)

// oxlint-disable-next-line ren/no-comments -- The model gateway, where brains send every model call (Providers P16). Managed: the service mints a key per brain. A gateway URL with one key: every brain gets that key.
export const make = Effect.gen(function* () {
  const managed = yield* Config.option(Config.String("REN_INFERENCE_URL"))
  const root = trimmed(Option.isSome(managed) ? managed.value : yield* Config.String("REN_INFERENCE_GATEWAY_URL"))
  const brainRoot = trimmed(
    yield* Config.String("REN_INFERENCE_BRAIN_URL").pipe(
      Config.orElse(() => Config.String("REN_INFERENCE_GATEWAY_URL")),
      Config.withDefault(root),
    ),
  )
  const inference = yield* RenInference.Service
  if (Option.isSome(managed))
    return {
      baseUrl: `${brainRoot}/v1`,
      key: (brainId, organizationId, spaceId) =>
        inference
          .grant(brainId, organizationId, spaceId)
          .pipe(Effect.mapError((cause) => new Models.Unavailable({ cause }))),
    } satisfies Models.Gateway
  const gatewayKey = yield* Config.Redacted("REN_INFERENCE_GATEWAY_KEY")
  return {
    baseUrl: `${brainRoot}/v1`,
    key: () =>
      Effect.map(DateTime.now, (now) => ({ key: gatewayKey, expiresAt: DateTime.addDuration(now, keyLifetime) })),
  } satisfies Models.Gateway
})
