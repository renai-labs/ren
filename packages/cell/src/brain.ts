export * as Brain from "./brain.js"

import { BrainApi } from "@ren/brain-api/brain-api"
import { ForbiddenError, ModelsNotConfiguredError } from "@ren/brain-api/errors"
import { DateTime, Effect, Layer, Option } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

type Services = Cell.Info | Cell.Activity | Harness.Service | ModelStore.Service | HostToken.Service

const prefix = "/ren"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

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
  const expired = stored.value.endpoints.find(
    (endpoint) =>
      Option.fromNullishOr(endpoint.apiKey.expiresAt).pipe(
        Option.exists((expiresAt) => DateTime.isLessThanOrEqualTo(expiresAt, now)),
      ),
  )
  if (expired?.apiKey.expiresAt)
    return yield* new ModelsNotConfiguredError({
      message: `Model refresh key expired: the key for endpoint ${expired.id} expired at ${DateTime.formatIso(expired.apiKey.expiresAt)}`,
    })
})

export const handlers = HttpApiBuilder.group(BrainApi, "brain", (group) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Services>()
    return group
      .handle("brain.start", (request) =>
        Effect.gen(function* () {
          const info = yield* Cell.Info
          if (request.payload.sessionId !== info.sessionId) return yield* Effect.fail(forbidden)
          yield* configured
          const harness = yield* Cell.acquire
          return yield* harness.start(request.payload)
        }).pipe(Effect.scoped, Effect.provide(context)),
      )
      .handle("brain.send", (request) =>
        Effect.gen(function* () {
          const info = yield* Cell.Info
          if (request.params.id !== info.sessionId) return yield* Effect.fail(forbidden)
          yield* configured
          const harness = yield* Cell.acquire
          return yield* harness.send({ ...request.payload, sessionId: request.params.id })
        }).pipe(Effect.scoped, Effect.provide(context)),
      )
      .handle("brain.configureModels", (request) =>
        Effect.gen(function* () {
          const store = yield* ModelStore.Service
          const activity = yield* Cell.Activity
          const host = yield* Harness.Service
          return yield* activity.configuring.withPermit(
            Effect.gen(function* () {
              // oxlint-disable-next-line ren/no-comments -- Writing before checking whether the harness is open guarantees that either a later open reads this configuration or this request applies it to the open instance.
              yield* store.write(request.payload.access, request.payload.hostToken)
              if ((yield* host.state).isOpen) {
                const harness = yield* Cell.acquire
                yield* harness.configure(request.payload.access.endpoints)
              }
            }),
          )
        }).pipe(Effect.scoped, Effect.provide(context)),
      )
      .handle("brain.removeModels", () =>
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
        }).pipe(Effect.scoped, Effect.provide(context)),
      )
      .handle("brain.state", () => Cell.state.pipe(Effect.provide(context)))
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
