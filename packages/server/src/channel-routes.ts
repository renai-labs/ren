export * as ChannelRoutes from "./channel-routes.js"

import { ChannelInstalls } from "@ren/core/channel-installs"
import { Channels } from "@ren/core/channels"
import { Channel } from "@ren/schema/channel"
import { Config, Effect, Option, Predicate, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const channels = yield* Channels.Service
    const installs = yield* ChannelInstalls.Service
    const auth = yield* Auth.Service
    const app = `${(yield* Config.String("APP_URL")).replace(/\/$/u, "")}/`
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
    yield* router.add("GET", "/channels/:provider/callback", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const provider = Schema.decodeUnknownOption(Channel.Provider)(params.provider)
        const session = yield* auth.getSession(new Headers(request.headers))
        const outcome = yield* installs.complete(
          params.provider ?? "",
          Object.fromEntries(new URL(request.url, "http://ren").searchParams),
          Option.map(session, (found) => found.user.id),
        )
        const target = new URL(
          Option.match(provider, { onNone: () => "settings/channels", onSome: (id) => `settings/channels/${id}` }),
          app,
        )
        if (!outcome.ok) target.searchParams.set("error", outcome.reason)
        if (outcome.ok && outcome.name) target.searchParams.set("installed", outcome.name)
        return HttpServerResponse.redirect(target.toString(), { status: 302 })
      }),
    )
  }),
)
