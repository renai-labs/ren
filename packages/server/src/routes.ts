export * as Routes from "./routes.js"

import { RenHostApi } from "@ren/host-api/ren-host-api"
import { SyncApi } from "@ren/host-api/sync-api"
import { Sync } from "@ren/schema/sync"
import { Access } from "@ren/core/access"
import { Agent } from "@ren/core/agent"
import { AgentMembership } from "@ren/core/agent/membership"
import { BrainHost } from "@ren/core/brain-host"
import { BrainRegistry } from "@ren/core/brain-registry"
import { EnvironmentTemplates } from "@ren/core/environment-templates"
import { Health } from "@ren/core/health"
import { Invitation } from "@ren/core/invitation"
import { Label } from "@ren/core/label"
import { OrganizationSettings } from "@ren/core/organization-settings"
import { Session } from "@ren/core/session"
import { SessionRunner } from "@ren/core/session/runner"
import { SessionSync } from "@ren/core/session-sync"
import { Space } from "@ren/core/space"
import { SpaceEnvironmentTemplate } from "@ren/core/space/environment-template"
import { SpaceMember } from "@ren/core/space/member"
import { SpaceSettings } from "@ren/core/space/settings"
import { Task } from "@ren/core/task"
import { TaskActivity } from "@ren/core/task/activity"
import { TaskComment } from "@ren/core/task/comment"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { Auth } from "./auth.js"
import { AgentHandler } from "./handlers/api/agent.js"
import { AgentMembershipHandler } from "./handlers/api/agent-membership.js"
import { ChatHandler } from "./handlers/api/chat.js"
import { HealthHandler } from "./handlers/api/health.js"
import { InvitationHandler } from "./handlers/api/invitation.js"
import { LabelHandler } from "./handlers/api/label.js"
import { MeHandler } from "./handlers/api/me.js"
import { EnvironmentTemplateHandler, EnvironmentProviderHandler } from "./handlers/api/environment-template.js"
import { OrganizationSettingsHandler } from "./handlers/api/organization-settings.js"
import { HostEnvironmentsHandler } from "./handlers/ren-host/environment.js"
import { HostModelsHandler } from "./handlers/ren-host/models.js"
import { HostPullHandler } from "./handlers/ren-host/pull.js"
import { HostTokenHandler } from "./handlers/ren-host/token.js"
import { SessionHandler } from "./handlers/api/session.js"
import { SpaceHandler } from "./handlers/api/space.js"
import { SpaceEnvironmentTemplateHandler } from "./handlers/api/space-environment-template.js"
import { SpaceMemberHandler } from "./handlers/api/space-member.js"
import { SpaceSettingsHandler } from "./handlers/api/space-settings.js"
import { TaskHandler } from "./handlers/api/task.js"
import { TaskActivityHandler } from "./handlers/api/task-activity.js"
import { TaskCommentHandler } from "./handlers/api/task-comment.js"
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
  Layer.mergeAll(
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
        SpaceSettingsHandler,
        OrganizationSettingsHandler,
        AgentHandler,
        AgentMembershipHandler,
        SessionHandler,
        ChatHandler,
        TaskHandler,
        TaskActivityHandler,
        TaskCommentHandler,
        LabelHandler,
      ]),
      Layer.provide([ActiveOrganizationLayer, AuthenticationLayer]),
      Layer.provide([
        Health.layer,
        Invitation.layer,
        Space.layer,
        SpaceMember.layer,
        EnvironmentTemplates.layer,
        SpaceEnvironmentTemplate.layer,
        SpaceSettings.layer,
        Layer.mergeAll(Task.layer, TaskActivity.layer, TaskComment.layer, Label.layer).pipe(
          Layer.provide(SessionRunner.layer),
          Layer.provide(BrainRegistry.layer),
        ),
        OrganizationSettings.layer,
        Agent.layer,
        AgentMembership.layer,
        Session.layer.pipe(Layer.provide(SessionRunner.layer), Layer.provide(BrainRegistry.layer)),
      ]),
    ),
    HttpApiBuilder.layer(RenHostApi).pipe(
      Layer.provide([HostPullHandler, HostModelsHandler, HostEnvironmentsHandler, HostTokenHandler]),
      Layer.provide(BrainHost.hostAuthentication),
    ),
    AuthRoute,
  ).pipe(Layer.provide(bodyLimit(1024 * 1024))),
  HttpApiBuilder.layer(SyncApi).pipe(
    Layer.provide(SyncHandler),
    Layer.provide([BrainHost.hostAuthentication, bodyLimit(Sync.maxBodyBytes), SessionSync.layer]),
  ),
  Cors,
).pipe(Layer.provide(Auth.layer), Layer.provide(Access.layer))
