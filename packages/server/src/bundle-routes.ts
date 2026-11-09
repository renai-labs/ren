export * as BundleRoutes from "./bundle-routes.js"

import { Bundles } from "@ren/core/bundles"
import { Bundle } from "@ren/schema/bundle"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

const Params = Schema.Struct({ kind: Bundle.Kind, version: Bundle.Version })

// oxlint-disable-next-line ren/no-comments -- A machine downloads one of Ren's bundles with the token Ren gave it for that bundle (EN26). A server that does not have the bundle answers 404; the machine asks again later.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const bundles = yield* Bundles.Service
    yield* router.add("GET", "/host/bundles/:kind/:version", (request) =>
      Effect.gen(function* () {
        const params = Schema.decodeUnknownOption(Params)(yield* HttpRouter.params)
        const token = Option.fromNullishOr(/^Bearer (.+)$/u.exec(request.headers.authorization ?? "")?.at(1))
        if (Option.isNone(params) || Option.isNone(token)) return HttpServerResponse.empty({ status: 404 })
        return yield* bundles.file(token.value, params.value).pipe(
          Effect.map((path) =>
            HttpServerResponse.raw(Bun.file(path), { headers: { "content-type": "application/gzip" } }),
          ),
          Effect.catchTag("Bundles.NotFound", () => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
        )
      }),
    )
  }),
)
