export * as ChannelRoutes from "./channel-routes.js"

import { ChannelInstalls } from "@ren/core/channel-installs"
import { Intake } from "@ren/core/intake"
import { Channel } from "@ren/schema/channel"
import { Config, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"
import { IntakeRequest } from "./intake-request.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const intake = yield* Intake.Service
    const installs = yield* ChannelInstalls.Service
    const auth = yield* Auth.Service
    const app = `${(yield* Config.String("APP_URL")).replace(/\/$/u, "")}/`
    yield* router.add("POST", "/channels/:provider", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const provider = Schema.decodeUnknownOption(Channel.Provider)(params.provider)
        if (Option.isNone(provider)) return HttpServerResponse.empty({ status: 404 })
        return IntakeRequest.response(
          yield* intake.receive(provider.value, IntakeRequest.of(request, yield* request.text)),
        )
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
