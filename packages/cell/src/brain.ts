export * as Brain from "./brain.js"

import { BrainApi, hostTokenHeader } from "@ren/host-api/brain-api"
import { ModelsNotConfiguredError, SyncUnavailableError } from "@ren/host-api/errors"
import { DateTime, Effect, Layer, Option, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { HotReload } from "./hot-reload.js"
import { Inference } from "./inference.js"
import { ModelRefresh } from "./model-refresh.js"
import { ModelStore } from "./model-store.js"
import { Restore } from "./restore.js"
import { Sync } from "./sync.js"

type Services =
  | Cell.Info
  | Cell.Activity
  | Harness.Service
  | ModelStore.Service
  | Inference.Service
  | ModelRefresh.Service
  | HostToken.Service
  | Sync.Service
  | HotReload.Service
  | Restore.Service

const prefix = "/ren"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

// oxlint-disable-next-line ren/no-comments -- E60, HR14: a brain without a valid host token or without a model list pulls and reads the models at once, then answers.
const check = Effect.gen(function* () {
  const inference = yield* Inference.Service
  const info = yield* Cell.Info
  const hostToken = yield* HostToken.Service
  if (info.vars.REN_URL && !(yield* hostToken.isValid))
    return Option.some(new ModelsNotConfiguredError({ message: "The brain’s host token is missing or expired" }))
  const catalog = yield* inference.catalog
  if (Option.isNone(catalog) || catalog.value.endpoints.length === 0)
    return Option.some(
      new ModelsNotConfiguredError({ message: "The brain has no model list: the inference service did not answer" }),
    )
  const store = yield* ModelStore.Service
  const now = yield* DateTime.now
  const expired = Option.getOrUndefined(yield* store.read)?.endpoints.find((endpoint) =>
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
  const refreshKey = yield* ModelRefresh.Service
  yield* hotReload.pull
  yield* refreshKey(ModelRefresh.anyEndpoint)
  const harness = yield* Cell.acquire
  yield* harness.refreshModels
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
            const hotReload = yield* HotReload.Service
            yield* hotReload.pull
            yield* configured
            const restore = yield* Restore.Service
            yield* restore
              .ensure(request.payload.sessionId, { isStarting: true })
              .pipe(
                Effect.catchTag("Restore.Unavailable", (error) =>
                  Effect.fail(
                    new SyncUnavailableError({ message: `Ren could not restore the chat: ${error.message}` }),
                  ),
                ),
              )
            const harness = yield* Cell.acquire
            return yield* harness.start(request.payload)
          }),
        ),
      )
      .handle("brain.send", (request) =>
        handle(
          Effect.gen(function* () {
            const hotReload = yield* HotReload.Service
            yield* hotReload.pull
            yield* configured
            const restore = yield* Restore.Service
            yield* restore
              .ensure(request.params.id)
              .pipe(
                Effect.catchTag("Restore.Unavailable", (error) =>
                  Effect.fail(
                    new SyncUnavailableError({ message: `Ren could not restore the chat: ${error.message}` }),
                  ),
                ),
              )
            const harness = yield* Cell.acquire
            return yield* harness.send({ ...request.payload, sessionId: request.params.id })
          }),
        ),
      )
      .handle("brain.setModel", (request) =>
        handle(
          Effect.gen(function* () {
            yield* configured
            const restore = yield* Restore.Service
            yield* restore
              .ensure(request.params.id)
              .pipe(
                Effect.catchTag("Restore.Unavailable", (error) =>
                  Effect.fail(
                    new SyncUnavailableError({ message: `Ren could not restore the chat: ${error.message}` }),
                  ),
                ),
              )
            const harness = yield* Cell.acquire
            yield* harness.setModel(request.params.id, Option.fromNullishOr(request.payload.model))
          }),
        ),
      )
      .handle("brain.wake", () =>
        handle(
          Effect.gen(function* () {
            const hotReload = yield* HotReload.Service
            const harness = yield* Harness.Service
            const sync = yield* Sync.Service
            yield* hotReload.pull
            // oxlint-disable-next-line ren/no-comments -- HR26: a resumed sandbox keeps its memory, so its model list is from before the pause.
            const opened = yield* harness.getIfOpen
            if (Option.isSome(opened)) yield* opened.value.refreshModels
            yield* sync.flush
          }),
        ),
      )
      .handle("brain.pull", () =>
        handle(
          Effect.gen(function* () {
            const hotReload = yield* HotReload.Service
            yield* hotReload.push
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
  Cell.BrainRoutes,
  Effect.gen(function* () {
    const app = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(BrainApi).pipe(Layer.provide(handlers), Layer.provide(HttpServer.layerServices)),
    )
    const context = yield* Effect.context<Services>()
    return Cell.BrainRoutes.of({ owns, fetch: HttpEffect.toWebHandler(app.pipe(Effect.provide(context))) })
  }),
)
