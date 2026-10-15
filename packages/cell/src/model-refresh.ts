export * as ModelRefresh from "./model-refresh.js"

import { ModelsApi } from "@ren/brain-api/models-api"
import type { Models } from "@ren/schema/models"
import { Clock, DateTime, Duration, Effect, Option, Semaphore } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { ModelStore } from "./model-store.js"

const key = "ren:host-token"

const window = Duration.minutes(5)

export const write = Effect.fn("ModelRefresh.write")(function* (
  storage: ModelStore.Storage,
  token: string | undefined,
) {
  if (!token) return yield* remove(storage)
  yield* Effect.promise(() => storage.put(key, token))
})

export const remove = Effect.fn("ModelRefresh.remove")(function* (storage: ModelStore.Storage) {
  yield* Effect.promise(() => storage.delete(key))
})

export const make = Effect.fn("ModelRefresh.make")(function* (storage: ModelStore.Storage, url: string | undefined) {
  const refreshing = yield* Semaphore.make(1)
  const client = url
    ? Option.some(yield* HttpApiClient.make(ModelsApi, { baseUrl: url }).pipe(Effect.provide(FetchHttpClient.layer)))
    : Option.none()
  const fresh = (apiKey: Models.ApiKey | undefined, afterMs: number, nowMs: number) =>
    Option.fromNullishOr(apiKey?.expiresAt).pipe(
      Option.exists(
        (expiresAt) => DateTime.toEpochMillis(expiresAt) > Math.max(afterMs, nowMs + Duration.toMillis(window)),
      ),
    )

  return (endpointId: string, expiresAtMs: number) =>
    refreshing.withPermit(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis
        const stored = yield* ModelStore.read(storage)
        const current = Option.getOrUndefined(stored)?.endpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey
        if (current && fresh(current, expiresAtMs, nowMs)) return Option.some(current)
        const token = yield* Effect.promise(() => storage.get(key))
        if (Option.isNone(client) || Option.isNone(stored) || typeof token !== "string") return Option.none()
        const body = yield* client.value.models["models.refresh"]({
          headers: { authorization: `Bearer ${token}` },
        }).pipe(Effect.tapErrorTag("ForbiddenError", () => remove(storage)))
        if ((yield* Effect.promise(() => storage.get(key))) !== token) return Option.none()
        yield* ModelStore.write(storage, body.access)
        yield* write(storage, body.hostToken)
        return Option.fromNullishOr(body.access.endpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey)
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Model access refresh failed", error).pipe(Effect.as(Option.none<Models.ApiKey>())),
        ),
      ),
    )
})
