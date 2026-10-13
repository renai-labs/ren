export * as Routes from "./routes.js"

import { Health } from "@ren/core/health"
import { Invitation } from "@ren/core/invitation"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { Auth } from "./auth.js"
import { HealthHandler } from "./handlers/health.js"
import { InvitationHandler } from "./handlers/invitation.js"
import { MeHandler } from "./handlers/me.js"
import { AuthenticationLayer } from "./middleware/authentication.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
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
    Layer.provide([HealthHandler, MeHandler, InvitationHandler]),
    Layer.provide(AuthenticationLayer),
    Layer.provide([Health.layer, Invitation.layer]),
  ),
  AuthRoute,
  Cors,
).pipe(Layer.provide(Auth.layer))
