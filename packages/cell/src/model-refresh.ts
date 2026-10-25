export * as ModelRefresh from "./model-refresh.js"

import { Models } from "@ren/schema/models"
import { Context, DateTime, Duration, Effect, Layer, Option, Redacted, Semaphore } from "effect"
import type { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

export class Service extends Context.Service<Service, Harness.Refresh>()("@ren/cell/ModelRefresh") {}

export const window = Duration.hours(3)

// oxlint-disable-next-line ren/no-comments -- One LiteLLM key reads the model list and serves every endpoint (HR29): anyEndpoint asks for that key: the grant's first one.
export const anyEndpoint = "*"

const keyOf = (access: Models.Access | undefined, endpointId: string) =>
  (endpointId === anyEndpoint
    ? access?.endpoints.at(0)
    : access?.endpoints.find((endpoint) => endpoint.id === endpointId)
  )?.apiKey

// oxlint-disable-next-line ren/no-comments -- Behind an egress the brain holds no model key: it sends the placeholder, and the egress puts the real key in (C8). The placeholder never expires, so it is never renewed.
export const layerEgress = Layer.succeed(
  Service,
  Service.of(() => Effect.succeed(Option.some({ key: Redacted.make(Models.placeholderKey) }))),
)

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

  const usable = (apiKey: Models.ApiKey | undefined, now: DateTime.Utc) =>
    Option.filter(Option.fromNullishOr(apiKey), (found) =>
      Option.match(Option.fromNullishOr(found.expiresAt), {
        onNone: () => true,
        onSome: (expiresAt) => DateTime.isGreaterThan(expiresAt, now),
      }),
    )

  return (endpointId: string) =>
    refreshing.withPermit(
      Effect.gen(function* () {
        const now = yield* DateTime.now
        const stored = yield* store.read
        const current = keyOf(Option.getOrUndefined(stored), endpointId)
        if (current && fresh(current, now)) return Option.some(current)
        if (Option.isNone(client)) return usable(current, now)
        const token = yield* hostToken.current
        if (Option.isNone(token)) return usable(current, now)
        const body = yield* client.value.models["models.refresh"]().pipe(
          HostToken.withToken(token.value),
          Effect.timeout(HostToken.renAnswersWithin),
          Effect.tapErrorTag("ForbiddenError", () => store.removeHostTokenIfUnchanged(token.value)),
        )
        if (
          !(yield* store.writeIfUnchanged(token.value, body.access, body.hostToken && Redacted.value(body.hostToken)))
        )
          return Option.none()
        return Option.fromNullishOr(keyOf(body.access, endpointId))
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Model access refresh failed; the brain keeps its key until it expires", error).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                const stored = Option.getOrUndefined(yield* store.read)
                return usable(keyOf(stored, endpointId), yield* DateTime.now)
              }),
            ),
          ),
        ),
      ),
    )
})

export const layer = (url: string | undefined) => Layer.effect(Service, make(url))
