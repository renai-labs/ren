export * as Brain from "./brain.js"

import { BrainApi } from "@ren/brain-api/brain-api"
import { ForbiddenError } from "@ren/brain-api/errors"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"

const prefix = "/ren"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

const forbidden = new ForbiddenError({ message: "The token is for another session" })

export const handlers = HttpApiBuilder.group(BrainApi, "brain", (group) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Cell.Info | Cell.Activity | Harness.Service>()
    return group
      .handle("brain.start", (request) =>
        Effect.gen(function* () {
          const info = yield* Cell.Info
          if (request.payload.sessionId !== info.sessionId) return yield* Effect.fail(forbidden)
          const harness = yield* Cell.acquire
          return yield* harness.start(request.payload)
        }).pipe(Effect.scoped, Effect.provide(context)),
      )
      .handle("brain.send", (request) =>
        Effect.gen(function* () {
          const info = yield* Cell.Info
          if (request.params.id !== info.sessionId) return yield* Effect.fail(forbidden)
          const harness = yield* Cell.acquire
          return yield* harness.send({ ...request.payload, sessionId: request.params.id })
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
