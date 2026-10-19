export * as HostToken from "./host-token.js"

import { HostApi } from "@ren/brain-api/host-api"
import { SessionToken } from "@ren/brain-api/session-token"
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { ModelStore } from "./model-store.js"

const refreshBefore = Duration.minutes(5)

export const renAnswersWithin = Duration.seconds(10)

export class Service extends Context.Service<
  Service,
  {
    readonly current: Effect.Effect<Option.Option<string>>
    readonly isValid: Effect.Effect<boolean>
  }
>()("@ren/cell/HostToken") {}

class Sent extends Context.Service<Sent, string>()("@ren/cell/HostToken/Sent") {}

export const client = (url: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
    return yield* HttpApiClient.makeWith(HostApi, {
      baseUrl: url,
      httpClient: HttpClient.mapRequestEffect(http, (request) =>
        Effect.map(Sent, (token) => HttpClientRequest.bearerToken(request, token)),
      ),
    })
  })

export const withToken = (token: string) => Effect.provideService(Sent, token)

export const layer = (url: string | undefined, keys: ReadonlyArray<SessionToken.Key>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* ModelStore.Service
      const refreshing = yield* Semaphore.make(1)
      const host = url ? Option.some(yield* client(url)) : Option.none()
      const expiresInMs = Effect.fnUntraced(function* (token: string) {
        const claims = yield* SessionToken.verify(keys, token)
        const now = yield* Clock.currentTimeMillis
        return Option.map(claims, (found) => found.exp * 1000 - now)
      })
      return Service.of({
        isValid: store.readHostToken.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (token) =>
                expiresInMs(token).pipe(
                  Effect.map(Option.exists((remaining) => remaining > Duration.toMillis(refreshBefore))),
                ),
            }),
          ),
        ),
        current: refreshing.withPermit(
          Effect.gen(function* () {
            const stored = yield* store.readHostToken
            if (Option.isNone(stored)) return Option.none<string>()
            const remaining = yield* expiresInMs(stored.value)
            if (Option.isNone(remaining) || remaining.value > Duration.toMillis(refreshBefore) || Option.isNone(host))
              return stored
            return yield* host.value.host["host.refresh"]().pipe(
              withToken(stored.value),
              Effect.timeout(renAnswersWithin),
              Effect.flatMap((body) => store.writeHostTokenIfUnchanged(stored.value, Redacted.value(body.hostToken))),
              Effect.andThen(store.readHostToken),
              Effect.catchTag("ForbiddenError", () =>
                store.removeHostTokenIfUnchanged(stored.value).pipe(Effect.as(Option.none<string>())),
              ),
              Effect.catch((error) =>
                Effect.logWarning("Host token refresh failed; the cell keeps its current host token", error).pipe(
                  Effect.as(stored),
                ),
              ),
            )
          }),
        ),
      })
    }),
  )
