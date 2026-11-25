import { timingSafeEqual } from "node:crypto"
import { ModelLists } from "@ren/core/model-lists"
import { Usage } from "@ren/core/usage"
import { ForbiddenError, UnauthorizedError, UnavailableError } from "@ren/protocol/errors"
import { UsageAuthentication, UsageIngestApi, UsageKey } from "@ren/protocol/usage-ingest"
import { Auth } from "@ren/schema/auth"
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { HttpApiBuilder } from "effect/http-api"

const digest = (key: Redacted.Redacted) => new Bun.CryptoHasher("sha256").update(Redacted.value(key)).digest()

export const UsageAuthenticationLayer = Layer.effect(
  UsageAuthentication,
  Effect.gen(function* () {
    // oxlint-disable-next-line ren/no-comments -- The integrations key writes only its own source, so a leaked key cannot write model or sandbox rows.
    const keys = [
      { key: yield* Config.option(Config.Redacted("USAGE_INGEST_KEY")), onlySource: Option.none<string>() },
      {
        key: yield* Config.option(Config.Redacted("INTEGRATIONS_INGEST_KEY")),
        onlySource: Option.some("ren-integrations"),
      },
    ]
    return UsageAuthentication.of({
      bearer: (httpEffect, options) => {
        const found = keys.find((entry) =>
          Option.exists(entry.key, (expected) => timingSafeEqual(digest(options.credential), digest(expected))),
        )
        return found
          ? Effect.provideService(httpEffect, UsageKey, { onlySource: found.onlySource })
          : Effect.fail(new UnauthorizedError({ message: "Unknown usage key." }))
      },
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- Providers §10: only the inference service's usage key, never the integrations key, says one organization's models changed. The push goes through Postgres, so it reaches the brains of every Ren process.
export const InferenceHandler = HttpApiBuilder.group(UsageIngestApi, "inference", (handlers) =>
  Effect.gen(function* () {
    const lists = yield* ModelLists.Service
    return handlers.handle("inference.changed", (request) =>
      Effect.gen(function* () {
        const key = yield* UsageKey
        if (Option.isSome(key.onlySource))
          return yield* new ForbiddenError({ message: "This key cannot report model changes." })
        yield* lists.refresh(Auth.OrganizationID.make(request.payload.organizationId))
      }),
    )
  }),
)

export const UsageHandler = HttpApiBuilder.group(UsageIngestApi, "usage", (handlers) =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    return handlers.handle("usage.record", (request) =>
      Effect.gen(function* () {
        const key = yield* UsageKey
        if (request.payload.events.some((event) => Option.exists(key.onlySource, (source) => source !== event.source)))
          return yield* new ForbiddenError({ message: "This key cannot write events of that source." })
        return yield* usage.record(request.payload.events)
      }).pipe(
        Effect.catchTag("Usage.Unavailable", () =>
          Effect.fail(new UnavailableError({ message: "The usage store is not available.", retryAfterMs: 5000 })),
        ),
      ),
    )
  }),
)
