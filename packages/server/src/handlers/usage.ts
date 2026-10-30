import { timingSafeEqual } from "node:crypto"
import { Usage } from "@ren/core/usage"
import { UnauthorizedError, UnavailableError } from "@ren/protocol/errors"
import { UsageAuthentication, UsageIngestApi, UsageProducer } from "@ren/protocol/usage-ingest"
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { HttpApiBuilder } from "effect/http-api"

const digest = (key: Redacted.Redacted) => new Bun.CryptoHasher("sha256").update(Redacted.value(key)).digest()

export const UsageAuthenticationLayer = Layer.effect(
  UsageAuthentication,
  Effect.gen(function* () {
    // oxlint-disable-next-line ren/no-comments -- The integrations key writes only its own source, so a leaked key cannot write model or sandbox rows.
    const keys = [
      {
        key: yield* Config.option(Config.Redacted("USAGE_INGEST_KEY")),
        source: Option.none<string>(),
      },
      {
        key: yield* Config.option(Config.Redacted("INTEGRATIONS_INGEST_KEY")),
        source: Option.some("ren-integrations"),
      },
    ]
    return UsageAuthentication.of({
      bearer: (httpEffect, options) => {
        const found = keys.find((entry) =>
          Option.exists(entry.key, (expected) => timingSafeEqual(digest(options.credential), digest(expected))),
        )
        return found
          ? Effect.provideService(httpEffect, UsageProducer, {
              source: found.source,
            })
          : Effect.fail(new UnauthorizedError({ message: "Unknown usage key." }))
      },
    })
  }),
)

export const UsageHandler = HttpApiBuilder.group(UsageIngestApi, "usage", (handlers) =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    return handlers.handle("usage.record", (request) =>
      Effect.gen(function* () {
        const producer = yield* UsageProducer
        if (request.payload.events.some((event) => Option.exists(producer.source, (source) => source !== event.source)))
          return yield* new UnauthorizedError({
            message: "This key cannot write events of that source.",
          })
        return yield* usage.record(request.payload.events)
      }).pipe(
        Effect.catchTag("Usage.Unavailable", () =>
          Effect.fail(
            new UnavailableError({
              message: "The usage store is not available.",
              retryAfterMs: 5000,
            }),
          ),
        ),
      ),
    )
  }),
)
