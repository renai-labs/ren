export * as Routes from "./routes.js"

import { ModelsApi } from "@ren/brain-api/models-api"
import { Access } from "@ren/core/access"
import { Health } from "@ren/core/health"
import { Invitation } from "@ren/core/invitation"
import { Space } from "@ren/core/space"
import { SpaceMember } from "@ren/core/space/member"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { Auth } from "./auth.js"
import { HealthHandler } from "./handlers/health.js"
import { InvitationHandler } from "./handlers/invitation.js"
import { MeHandler } from "./handlers/me.js"
import { ModelsHandler } from "./handlers/models.js"
import { SpaceHandler } from "./handlers/space.js"
import { SpaceMemberHandler } from "./handlers/space-member.js"
import { ActiveOrganizationLayer } from "./middleware/active-organization.js"
import { AuthenticationLayer } from "./middleware/authentication.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
const AuthRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* router.add("*", "/auth/*", HttpEffect.fromWebHandler(auth.handler))
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
    Layer.provide([HealthHandler, MeHandler, InvitationHandler, SpaceHandler, SpaceMemberHandler]),
    Layer.provide([ActiveOrganizationLayer, AuthenticationLayer]),
    Layer.provide([Health.layer, Invitation.layer, Space.layer, SpaceMember.layer]),
  ),
  HttpApiBuilder.layer(ModelsApi).pipe(Layer.provide(ModelsHandler)),
  AuthRoute,
  Cors,
).pipe(Layer.provide(Auth.layer), Layer.provide(Access.layer))
