export * as FaviconRoutes from "./favicon-routes.js"

import { Favicon } from "@ren/core/favicon"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

// oxlint-disable-next-line ren/no-comments -- Ren fetches a linked site's icon, so the site never learns who reads the chat. The CSP and `nosniff` keep an icon opened on its own inert.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const favicon = yield* Favicon.Service
    yield* router.add("GET", "/favicons/:host", (request) =>
      Effect.gen(function* () {
        const session = yield* auth.getSession(new Headers(request.headers))
        if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 })
        const params = yield* HttpRouter.params
        const icon = yield* favicon.read(params.host ?? "")
        if (Option.isNone(icon)) return HttpServerResponse.empty({ status: 404 })
        return HttpServerResponse.uint8Array(icon.value.bytes, {
          contentType: icon.value.type,
          headers: {
            "cache-control": "private, max-age=86400",
            "content-security-policy": "default-src 'none'",
            "x-content-type-options": "nosniff",
          },
        })
      }),
    )
  }),
)
