export * as IconRoutes from "./icon-routes.js"

import { Icons } from "@ren/core/icons"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

// oxlint-disable-next-line ren/no-comments -- Public: an icon's name is the hash of its bytes, so a URL shows one picture and never changes. The CSP and `nosniff` keep an icon opened on its own inert.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const icons = yield* Icons.Service
    yield* router.add("GET", "/icons/:name", () =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const hash = /^([a-f0-9]{64})\.webp$/u.exec(params.name ?? "")?.at(1)
        const icon = hash ? yield* icons.read(hash) : Option.none()
        if (Option.isNone(icon)) return HttpServerResponse.empty({ status: 404 })
        return HttpServerResponse.uint8Array(icon.value, {
          contentType: Icons.type,
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-security-policy": "default-src 'none'",
            "x-content-type-options": "nosniff",
          },
        })
      }).pipe(Effect.catchTag("Icons.Unavailable", () => Effect.succeed(HttpServerResponse.empty({ status: 503 })))),
    )
  }),
)
