export * as Brain from "./brain.js"

import { BrainApi } from "@ren/brain-api/brain-api"
import { ForbiddenError, ModelsNotConfiguredError } from "@ren/brain-api/errors"
import { Effect, Layer, Option } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { ModelStore } from "./model-store.js"
import { Renewal } from "./renewal.js"

const prefix = "/ren"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

const forbidden = new ForbiddenError({ message: "The token is for another session" })

const notConfigured = new ModelsNotConfiguredError({ message: "The brain has no model configuration" })

const configured = Effect.gen(function* () {
  const info = yield* Cell.Info
  if (Option.isNone(yield* ModelStore.read(info.storage))) return yield* Effect.fail(notConfigured)
})

export const handlers = HttpApiBuilder.group(BrainApi, "brain", (group) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Cell.Info | Cell.Activity | Harness.Service>()
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
      .handle("brain.models", (request) =>
        Effect.gen(function* () {
          const info = yield* Cell.Info
          const activity = yield* Cell.Activity
          const host = yield* Harness.Service
          return yield* activity.configuring.withPermit(
            Effect.gen(function* () {
              // oxlint-disable-next-line ren/no-comments -- Writing before checking whether the harness is open guarantees that either a later open reads this configuration or this request applies it to the open instance.
              yield* ModelStore.write(info.storage, request.payload.access)
              yield* Renewal.write(info.storage, request.payload.renewalToken)
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
          const info = yield* Cell.Info
          const activity = yield* Cell.Activity
          const host = yield* Harness.Service
          yield* activity.configuring.withPermit(
            Effect.gen(function* () {
              yield* ModelStore.remove(info.storage)
              yield* Renewal.remove(info.storage)
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
    const context = yield* Effect.context<Cell.Info | Cell.Activity | Harness.Service>()
    return Cell.Brain.of({ owns, fetch: HttpEffect.toWebHandler(app.pipe(Effect.provide(context))) })
  }),
)
