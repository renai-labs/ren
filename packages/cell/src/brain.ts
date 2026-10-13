export * as Brain from "./brain.js"

import { BrainApi } from "@ren/protocol/brain-api"
import { ForbiddenError } from "@ren/protocol/errors"
import { Effect, Layer, type Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import type { Harness } from "./harness/harness.js"

export const make = (sessionId: string | undefined, open: Effect.Effect<Harness.Instance, Error, Scope.Scope>) => {
  const harness = Effect.orDie(open)
  const forbidden = new ForbiddenError({ message: "The token is for another session" })
  const handlers = HttpApiBuilder.group(BrainApi, "brain", (group) =>
    group
      .handle("brain.start", (request) =>
        request.payload.sessionId === sessionId
          ? Effect.scoped(Effect.flatMap(harness, (opened) => opened.start(request.payload)))
          : Effect.fail(forbidden),
      )
      .handle("brain.send", (request) =>
        request.params.id === sessionId
          ? Effect.scoped(
              Effect.flatMap(harness, (opened) => opened.send({ ...request.payload, sessionId: request.params.id })),
            )
          : Effect.fail(forbidden),
      ),
  )
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(BrainApi).pipe(Layer.provide(handlers), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  ).handler
}
