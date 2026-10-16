export * as ModelRefresh from "./model-refresh.js"

import { ModelsApi } from "@ren/brain-api/models-api"
import type { Models } from "@ren/schema/models"
import { Context, DateTime, Duration, Effect, Layer, Option, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import type { Harness } from "./harness/harness.js"
import { ModelStore } from "./model-store.js"

export class Service extends Context.Service<Service, Harness.Refresh>()("@ren/cell/ModelRefresh") {}

class HostToken extends Context.Service<HostToken, string>()("@ren/cell/ModelRefresh/HostToken") {}

const window = Duration.minutes(5)

const make = Effect.fn("ModelRefresh.make")(function* (url: string | undefined) {
  const store = yield* ModelStore.Service
  const refreshing = yield* Semaphore.make(1)
  const http = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
  const client = url
    ? Option.some(
        yield* HttpApiClient.makeWith(ModelsApi, {
          baseUrl: url,
          httpClient: HttpClient.mapRequestEffect(http, (request) =>
            Effect.gen(function* () {
              const token = yield* HostToken
              return HttpClientRequest.bearerToken(request, token)
            }),
          ),
        }),
      )
    : Option.none()
  const fresh = (apiKey: Models.ApiKey, now: DateTime.Utc) =>
    Option.fromNullishOr(apiKey.expiresAt).pipe(
      Option.exists((expiresAt) => DateTime.isGreaterThan(expiresAt, DateTime.addDuration(now, window))),
    )

  return (endpointId: string) =>
    refreshing.withPermit(
      Effect.gen(function* () {
        const now = yield* DateTime.now
        const stored = yield* store.read
        const current = Option.getOrUndefined(stored)?.endpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey
        if (current && fresh(current, now)) return Option.some(current)
        const token = yield* store.readHostToken
        if (Option.isNone(client) || Option.isNone(stored) || Option.isNone(token)) return Option.none()
        const body = yield* client.value.models["models.refresh"]().pipe(
          Effect.provideService(HostToken, token.value),
          Effect.tapErrorTag("ForbiddenError", () => store.removeHostToken),
        )
        if (Option.getOrUndefined(yield* store.readHostToken) !== token.value) return Option.none()
        yield* store.write(body.access, body.hostToken)
        return Option.fromNullishOr(body.access.endpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey)
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Model access refresh failed", error).pipe(Effect.as(Option.none<Models.ApiKey>())),
        ),
      ),
    )
})

export const layer = (url: string | undefined) => Layer.effect(Service, make(url))
