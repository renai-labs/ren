export * as HostToken from "./host-token.js"

import { BrainToken } from "@ren/host-api/brain-token"
import { RenHostApi } from "@ren/host-api/ren-host-api"
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Fence } from "./fence.js"
import { ModelStore } from "./model-store.js"

const refreshBefore = Duration.hours(1)

export const renAnswersWithin = Duration.seconds(10)

export class Service extends Context.Service<
  Service,
  {
    readonly current: Effect.Effect<Option.Option<string>>
    readonly isValid: Effect.Effect<boolean>
  }
>()("@ren/cell/HostToken") {}

class PresentedToken extends Context.Service<PresentedToken, string>()("@ren/cell/HostToken/PresentedToken") {}

export const client = (url: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    return yield* HttpApiClient.makeWith(RenHostApi, {
      baseUrl: url,
      httpClient: HttpClient.mapRequestEffect(http, (request) =>
        Effect.map(PresentedToken, (token) => HttpClientRequest.bearerToken(request, token)),
      ),
    })
  })

export const withToken = (token: string) => Effect.provideService(PresentedToken, token)

// oxlint-disable-next-line ren/no-comments -- Behind an egress the brain holds no host token: it sends the placeholder, and the egress puts the real token in on each call to Ren's host (C8, token-removal.md).
const placeholder = "ren:REN"

export const layerEgress = Layer.succeed(
  Service,
  Service.of({ current: Effect.succeed(Option.some(placeholder)), isValid: Effect.succeed(true) }),
)

export const layer = (url: string | undefined) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* ModelStore.Service
      const fence = yield* Fence.Service
      const refreshing = yield* Semaphore.make(1)
      const host = url ? Option.some(yield* client(url)) : Option.none()
      const remainingMs = Effect.fnUntraced(function* (token: string) {
        const now = yield* Clock.currentTimeMillis
        return Option.map(BrainToken.expiry(token), (exp) => exp * 1000 - now)
      })
      return Service.of({
        isValid: store.readHostToken.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (token) => remainingMs(token).pipe(Effect.map(Option.exists((remaining) => remaining > 0))),
            }),
          ),
        ),
        current: refreshing.withPermit(
          Effect.gen(function* () {
            const stored = yield* store.readHostToken
            if (Option.isNone(stored)) return Option.none<string>()
            const remaining = yield* remainingMs(stored.value)
            if (Option.isNone(remaining) || remaining.value <= 0) return Option.none<string>()
            if (remaining.value > Duration.toMillis(refreshBefore) || Option.isNone(host)) return stored
            return yield* host.value.host["host.refresh"]().pipe(
              withToken(stored.value),
              Effect.timeout(renAnswersWithin),
              Effect.flatMap((body) => store.writeHostTokenIfUnchanged(stored.value, Redacted.value(body.hostToken))),
              Effect.andThen(store.readHostToken),
              Effect.catchTag("GenerationRetiredError", (error) => fence.retire(error.message).pipe(Effect.as(stored))),
              Effect.catch((error) =>
                Effect.logWarning("Host token refresh failed; the brain keeps its current host token", error).pipe(
                  Effect.as(stored),
                ),
              ),
            )
          }),
        ),
      })
    }),
  )
