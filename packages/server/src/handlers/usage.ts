import { Usage } from "@ren/core/usage"
import { ForbiddenError, UnauthorizedError, UnavailableError } from "@ren/protocol/errors"
import { CurrentProducer, UsageAuthentication, UsageIngestApi } from "@ren/protocol/usage-ingest"
import { Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const UsageAuthenticationLayer = Layer.effect(
  UsageAuthentication,
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    return UsageAuthentication.of({
      bearer: Effect.fn("UsageAuthentication.bearer")(function* (httpEffect, options) {
        const producer = yield* usage.authenticate(options.credential)
        if (Option.isNone(producer)) return yield* new UnauthorizedError({ message: "Unknown usage key." })
        return yield* httpEffect.pipe(Effect.provideService(CurrentProducer, producer.value))
      }),
    })
  }),
)

export const UsageHandler = HttpApiBuilder.group(UsageIngestApi, "usage", (handlers) =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    return handlers.handle("usage.record", (request) =>
      Effect.gen(function* () {
        const producer = yield* CurrentProducer
        return yield* usage.record(producer, request.payload.events).pipe(
          Effect.catchTags({
            "Usage.Forbidden": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
            "Usage.Unavailable": (error) =>
              Effect.fail(new UnavailableError({ message: error.message, retryAfterMs: 5000 })),
          }),
        )
      }),
    )
  }),
)
