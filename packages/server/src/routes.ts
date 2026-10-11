export * as Routes from "./routes.js"

import { Auth } from "@ren/core/auth"
import { Health } from "@ren/core/health"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { HealthHandler } from "./handlers/health.js"
import { MeHandler } from "./handlers/me.js"
import { AuthenticationLayer } from "./middleware/authentication.js"

const AuthRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* router.add("*", "/api/auth/*", HttpEffect.fromWebHandler(auth.handler))
  }),
)

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return HttpMiddleware.cors({
      allowedOrigins: (origin) => auth.trustedOrigins.includes(origin),
      allowedHeaders: ["authorization", "content-type"],
      credentials: true,
    })
  }),
  { global: true },
)

export const layer = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide([HealthHandler, MeHandler]),
    Layer.provide(AuthenticationLayer),
    Layer.provide(Health.layer),
  ),
  AuthRoute,
  Cors,
).pipe(Layer.provide(Auth.layer))
