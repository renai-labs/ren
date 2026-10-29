import { timingSafeEqual } from "node:crypto"
import { Usage } from "@ren/core/usage"
import { UnauthorizedError, UnavailableError } from "@ren/protocol/errors"
import { UsageAuthentication, UsageIngestApi } from "@ren/protocol/usage-ingest"
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { HttpApiBuilder } from "effect/http-api"

const digest = (key: Redacted.Redacted) => new Bun.CryptoHasher("sha256").update(Redacted.value(key)).digest()

export const UsageAuthenticationLayer = Layer.effect(
  UsageAuthentication,
  Effect.gen(function* () {
    const key = yield* Config.option(Config.Redacted("USAGE_INGEST_KEY"))
    return UsageAuthentication.of({
      bearer: (httpEffect, options) =>
        Option.exists(key, (expected) => timingSafeEqual(digest(options.credential), digest(expected)))
          ? httpEffect
          : Effect.fail(new UnauthorizedError({ message: "Unknown usage key." })),
    })
  }),
)

export const UsageHandler = HttpApiBuilder.group(UsageIngestApi, "usage", (handlers) =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    return handlers.handle("usage.record", (request) =>
      usage
        .record(request.payload.events)
        .pipe(
          Effect.catchTag("Usage.Unavailable", (error) =>
            Effect.fail(new UnavailableError({ message: error.message, retryAfterMs: 5000 })),
          ),
        ),
    )
  }),
)
