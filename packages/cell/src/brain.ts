export * as Brain from "./brain.js"

import { BrainApi } from "@ren/host-api/brain-api"
import { ModelsNotConfiguredError } from "@ren/host-api/errors"
import { DateTime, Effect, Layer, Option, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { HotReload } from "./hot-reload.js"
import { ModelStore } from "./model-store.js"
import { Sync } from "./sync.js"

type Services =
  | Cell.Info
  | Cell.Activity
  | Harness.Service
  | ModelStore.Service
  | HostToken.Service
  | Sync.Service
  | HotReload.Service

const prefix = "/ren"

export const hostTokenHeader = "ren-host-token"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

const check = Effect.gen(function* () {
  const store = yield* ModelStore.Service
  const info = yield* Cell.Info
  const hostToken = yield* HostToken.Service
  const stored = yield* store.read
  if (Option.isNone(stored))
    return Option.some(new ModelsNotConfiguredError({ message: "The brain has no model configuration" }))
  if (info.vars.REN_URL && !(yield* hostToken.isValid))
    return Option.some(new ModelsNotConfiguredError({ message: "The brain’s host token is missing or expired" }))
  const now = yield* DateTime.now
  const expired = stored.value.endpoints.find((endpoint) =>
    Option.fromNullishOr(endpoint.apiKey.expiresAt).pipe(
      Option.exists((expiresAt) => DateTime.isLessThanOrEqualTo(expiresAt, now)),
    ),
  )
  if (expired?.apiKey.expiresAt)
    return Option.some(
      new ModelsNotConfiguredError({
        message: `The key for endpoint ${expired.id} expired at ${DateTime.formatIso(expired.apiKey.expiresAt)}`,
      }),
    )
  return Option.none()
})

const configured = Effect.gen(function* () {
  if (Option.isNone(yield* check)) return
  const hotReload = yield* HotReload.Service
  const store = yield* ModelStore.Service
  yield* store.forget
  yield* hotReload.pull
  const again = yield* check
  if (Option.isSome(again)) return yield* again.value
})

const keepHostToken = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const token = request.headers[hostTokenHeader]
  if (!token) return
  const store = yield* ModelStore.Service
  yield* store.keepHostToken(token)
})

export const handlers = HttpApiBuilder.group(BrainApi, "brain", (group) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Services>()
    const handle = <A, E>(effect: Effect.Effect<A, E, Services | Scope.Scope>) =>
      keepHostToken.pipe(Effect.andThen(effect), Effect.scoped, Effect.provide(context))
    return group
      .handle("brain.start", (request) =>
        handle(
          Effect.gen(function* () {
            const harness = yield* Cell.acquire
            const hotReload = yield* HotReload.Service
            yield* hotReload.pull
            yield* configured
            return yield* harness.start(request.payload)
          }),
        ),
      )
      .handle("brain.send", (request) =>
        handle(
          Effect.gen(function* () {
            yield* configured
            const harness = yield* Cell.acquire
            return yield* harness.send({ ...request.payload, sessionId: request.params.id })
          }),
        ),
      )
      .handle("brain.setModel", (request) =>
        handle(
          Effect.gen(function* () {
            yield* configured
            const harness = yield* Cell.acquire
            yield* harness.setModel(request.params.id, Option.fromNullishOr(request.payload.model))
          }),
        ),
      )
      .handle("brain.wake", () =>
        handle(
          Effect.gen(function* () {
            const store = yield* ModelStore.Service
            const hotReload = yield* HotReload.Service
            const sync = yield* Sync.Service
            yield* store.forget
            yield* hotReload.pull
            yield* sync.flush
          }),
        ),
      )
      .handle("brain.sync", () =>
        handle(
          Effect.gen(function* () {
            const sync = yield* Sync.Service
            return { drained: yield* sync.flush }
          }),
        ),
      )
      .handle("brain.state", () => handle(Cell.state))
  }),
)

export const layer = Layer.effect(
  Cell.Brain,
  Effect.gen(function* () {
    const app = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(BrainApi).pipe(Layer.provide(handlers), Layer.provide(HttpServer.layerServices)),
    )
    const context = yield* Effect.context<Services>()
    return Cell.Brain.of({ owns, fetch: HttpEffect.toWebHandler(app.pipe(Effect.provide(context))) })
  }),
)
