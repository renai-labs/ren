export * as FaviconRoutes from "./favicon-routes.js"

import { Favicon } from "@ren/core/favicon"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

// oxlint-disable-next-line ren/no-comments -- chat-links F1: the browser asks Ren for a linked site's icon, so no linked site or third party learns who reads the chat. A signed-in person only, one host in the path, never the link's path or query. SVG never leaves Favicon (script on Ren's origin); `default-src 'none'` and `nosniff` keep any icon inert if opened on its own.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const favicon = yield* Favicon.Service
    yield* router.add("GET", "/favicons/:host", (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const session = yield* auth.getSession(new Headers(request.headers))
        if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 })
        const params = yield* HttpRouter.params
        const icon = yield* Effect.result(favicon.read(session.value.user.id, params.host ?? ""))
        if (Result.isFailure(icon)) return HttpServerResponse.empty({ status: 429, headers: { "retry-after": "60" } })
        if (Option.isNone(icon.success)) return HttpServerResponse.empty({ status: 404 })
        return HttpServerResponse.uint8Array(icon.success.value.bytes, {
          contentType: icon.success.value.type,
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
