export * as ChannelRoutes from "./channel-routes.js"

import { Channels } from "@ren/core/channels"
import { Effect, Predicate } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const channels = yield* Channels.Service
    yield* router.add("POST", "/channels/:provider", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const body = yield* request.text
        const reply = yield* channels.receive(params.provider ?? "", {
          headers: new Headers(request.headers),
          body,
        })
        return Predicate.isUndefined(reply.body)
          ? HttpServerResponse.empty({ status: reply.status })
          : HttpServerResponse.jsonUnsafe(reply.body, { status: reply.status })
      }).pipe(Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))),
    )
  }),
)
