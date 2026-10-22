export * as ModelRefresh from "./model-refresh.js"

import type { Models } from "@ren/schema/models"
import { Context, DateTime, Duration, Effect, Layer, Option, Redacted, Semaphore } from "effect"
import type { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

export class Service extends Context.Service<Service, Harness.Refresh>()("@ren/cell/ModelRefresh") {}

const window = Duration.hours(3)

const make = Effect.fn("ModelRefresh.make")(function* (url: string | undefined) {
  const store = yield* ModelStore.Service
  const hostToken = yield* HostToken.Service
  const refreshing = yield* Semaphore.make(1)
  const client = url ? Option.some(yield* HostToken.client(url)) : Option.none()
  const fresh = (apiKey: Models.ApiKey, now: DateTime.Utc) =>
    Option.match(Option.fromNullishOr(apiKey.expiresAt), {
      onNone: () => true,
      onSome: (expiresAt) => DateTime.isGreaterThan(expiresAt, DateTime.addDuration(now, window)),
    })

  return (endpointId: string) =>
    refreshing.withPermit(
      Effect.gen(function* () {
        const now = yield* DateTime.now
        const stored = yield* store.read
        const current = Option.getOrUndefined(stored)?.endpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey
        if (current && fresh(current, now)) return Option.some(current)
        if (Option.isNone(client) || Option.isNone(stored)) return Option.none()
        const token = yield* hostToken.current
        if (Option.isNone(token)) return Option.none()
        const body = yield* client.value.models["models.refresh"]().pipe(
          HostToken.withToken(token.value),
          Effect.timeout(HostToken.renAnswersWithin),
          Effect.tapErrorTag("ForbiddenError", () => store.removeHostTokenIfUnchanged(token.value)),
        )
        if (
          !(yield* store.writeIfUnchanged(token.value, body.access, body.hostToken && Redacted.value(body.hostToken)))
        )
          return Option.none()
        return Option.fromNullishOr(body.access.endpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey)
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Model access refresh failed", error).pipe(Effect.as(Option.none<Models.ApiKey>())),
        ),
      ),
    )
})

export const layer = (url: string | undefined) => Layer.effect(Service, make(url))
