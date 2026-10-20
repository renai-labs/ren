export * as Brain from "./brain.js"

import { BrainApi } from "@ren/host-api/brain-api"
import { ForbiddenError, ModelsNotConfiguredError } from "@ren/host-api/errors"
import { DateTime, Effect, Layer, Option, Redacted, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"
import { Sync } from "./sync.js"

type Services = Cell.Info | Cell.Activity | Harness.Service | ModelStore.Service | HostToken.Service | Sync.Service

const prefix = "/ren"

export const hostTokenHeader = "ren-host-token"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

export const allowsClient = (pathname: string) => /^\/ren\/sessions\/[^/]+\/model$/u.test(pathname)

const forbidden = new ForbiddenError({ message: "The token is for another session" })

const notConfigured = new ModelsNotConfiguredError({ message: "The brain has no model configuration" })

const configured = Effect.gen(function* () {
  const store = yield* ModelStore.Service
  const info = yield* Cell.Info
  const hostToken = yield* HostToken.Service
  const stored = yield* store.read
  if (Option.isNone(stored)) return yield* Effect.fail(notConfigured)
  if (info.vars.REN_URL && !(yield* hostToken.isValid))
    return yield* new ModelsNotConfiguredError({ message: "The brain’s host token is missing or expires soon" })
  const now = yield* DateTime.now
  const expired = stored.value.endpoints.find((endpoint) =>
    Option.fromNullishOr(endpoint.apiKey.expiresAt).pipe(
      Option.exists((expiresAt) => DateTime.isLessThanOrEqualTo(expiresAt, now)),
    ),
  )
  if (expired?.apiKey.expiresAt)
    return yield* new ModelsNotConfiguredError({
      message: `Model refresh key expired: the key for endpoint ${expired.id} expired at ${DateTime.formatIso(expired.apiKey.expiresAt)}`,
    })
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
            const info = yield* Cell.Info
            if (request.payload.sessionId !== info.sessionId) return yield* Effect.fail(forbidden)
            yield* configured
            const harness = yield* Cell.acquire
            return yield* harness.start(request.payload)
          }),
        ),
      )
      .handle("brain.send", (request) =>
        handle(
          Effect.gen(function* () {
            const info = yield* Cell.Info
            if (request.params.id !== info.sessionId) return yield* Effect.fail(forbidden)
            yield* configured
            const harness = yield* Cell.acquire
            return yield* harness.send({ ...request.payload, sessionId: request.params.id })
          }),
        ),
      )
      .handle("brain.setModel", (request) =>
        handle(
          Effect.gen(function* () {
            const info = yield* Cell.Info
            if (request.params.id !== info.sessionId) return yield* Effect.fail(forbidden)
            yield* configured
            const harness = yield* Cell.acquire
            yield* harness.setModel(request.params.id, Option.fromNullishOr(request.payload.model))
          }),
        ),
      )
      .handle("brain.configureModels", (request) =>
        handle(
          Effect.gen(function* () {
            const store = yield* ModelStore.Service
            const activity = yield* Cell.Activity
            const host = yield* Harness.Service
            return yield* activity.configuring.withPermit(
              Effect.gen(function* () {
                // oxlint-disable-next-line ren/no-comments -- Writing before checking whether the harness is open guarantees that either a later open reads this configuration or this request applies it to the open instance.
                yield* store.write(
                  request.payload.access,
                  request.payload.hostToken && Redacted.value(request.payload.hostToken),
                )
                if ((yield* host.state).isOpen) {
                  const harness = yield* Cell.acquire
                  yield* harness.configure(request.payload.access.endpoints)
                }
              }),
            )
          }),
        ),
      )
      .handle("brain.removeModels", () =>
        handle(
          Effect.gen(function* () {
            const store = yield* ModelStore.Service
            const activity = yield* Cell.Activity
            const host = yield* Harness.Service
            yield* activity.configuring.withPermit(
              Effect.gen(function* () {
                yield* store.remove
                if ((yield* host.state).isOpen) {
                  const harness = yield* Cell.acquire
                  yield* harness.configure([])
                }
              }),
            )
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
