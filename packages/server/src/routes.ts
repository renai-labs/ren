export * as Routes from "./routes.js"

import { RenHostApi } from "@ren/host-api/ren-host-api"
import { maxBodyBytes, SyncApi } from "@ren/host-api/sync-api"
import { Access } from "@ren/core/access"
import { BrainHost } from "@ren/core/brain-host"
import { EnvironmentTemplates } from "@ren/core/environment-templates"
import { Health } from "@ren/core/health"
import { Invitation } from "@ren/core/invitation"
import { SessionSync } from "@ren/core/session-sync"
import { Space } from "@ren/core/space"
import { SpaceEnvironmentTemplate } from "@ren/core/space/environment-template"
import { SpaceMember } from "@ren/core/space/member"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { Auth } from "./auth.js"
import { HealthHandler } from "./handlers/api/health.js"
import { InvitationHandler } from "./handlers/api/invitation.js"
import { MeHandler } from "./handlers/api/me.js"
import { EnvironmentTemplateHandler, EnvironmentProviderHandler } from "./handlers/api/environment-template.js"
import { HostEnvironmentsHandler } from "./handlers/ren-host/environment.js"
import { HostModelsHandler } from "./handlers/ren-host/models.js"
import { HostTokenHandler } from "./handlers/ren-host/token.js"
import { SpaceHandler } from "./handlers/api/space.js"
import { SpaceEnvironmentTemplateHandler } from "./handlers/api/space-environment-template.js"
import { SpaceMemberHandler } from "./handlers/api/space-member.js"
import { SyncHandler } from "./handlers/sync.js"
import { ActiveOrganizationLayer } from "./middleware/active-organization.js"
import { AuthenticationLayer } from "./middleware/authentication.js"
import { bodyLimit } from "./middleware/body-limit.js"

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
    Layer.provide([
      HealthHandler,
      MeHandler,
      InvitationHandler,
      SpaceHandler,
      SpaceMemberHandler,
      EnvironmentTemplateHandler,
      EnvironmentProviderHandler,
      SpaceEnvironmentTemplateHandler,
    ]),
    Layer.provide([ActiveOrganizationLayer, AuthenticationLayer]),
    Layer.provide([
      Health.layer,
      Invitation.layer,
      Space.layer,
      SpaceMember.layer,
      EnvironmentTemplates.layer,
      SpaceEnvironmentTemplate.layer,
    ]),
  ),
  HttpApiBuilder.layer(RenHostApi).pipe(
    Layer.provide([HostModelsHandler, HostEnvironmentsHandler, HostTokenHandler]),
    Layer.provide(BrainHost.hostAuthentication),
  ),
  HttpApiBuilder.layer(SyncApi).pipe(
    Layer.provide(SyncHandler),
    Layer.provide([BrainHost.hostAuthentication, bodyLimit(maxBodyBytes), SessionSync.layer]),
  ),
  AuthRoute,
  Cors,
).pipe(Layer.provide(Auth.layer), Layer.provide(Access.layer))
