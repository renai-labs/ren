export * as Routes from "./routes.js"

import { RenHostApi } from "@ren/host-api/ren-host-api"
import { SyncApi } from "@ren/host-api/sync-api"
import { Sync } from "@ren/schema/sync"
import { Access } from "@ren/core/access"
import { Agent } from "@ren/core/agent"
import { App } from "@ren/core/app"
import { AppRegistry } from "@ren/core/app/registry"
import { AgentMembership } from "@ren/core/agent/membership"
import { Brains } from "@ren/core/brains"
import { BrainRegistry } from "@ren/core/brain-registry"
import { ChannelInstalls } from "@ren/core/channel-installs"
import { ChannelMappings } from "@ren/core/channel-mappings"
import { SlackBot } from "@ren/core/slack-bot"
import { ChannelTurns } from "@ren/core/channel-turns"
import { Channels } from "@ren/core/channels"
import { EnvironmentTemplates } from "@ren/core/environment-templates"
import { Health } from "@ren/core/health"
import { InfraSpecs } from "@ren/core/infra-specs"
import { Insights } from "@ren/core/insights"
import { Invitation } from "@ren/core/invitation"
import { Label } from "@ren/core/label"
import { Memory } from "@ren/core/memory"
import { OrganizationSettings } from "@ren/core/organization-settings"
import { ScheduleTrigger } from "@ren/core/schedule-trigger"
import { Schedules } from "@ren/core/schedules"
import { Session } from "@ren/core/session"
import { SessionRunner } from "@ren/core/session/runner"
import { SessionSync } from "@ren/core/session-sync"
import { Space } from "@ren/core/space"
import { SpaceEnvironmentTemplate } from "@ren/core/space/environment-template"
import { SpaceMember } from "@ren/core/space/member"
import { ReferenceCheck } from "@ren/core/reference-check"
import { RepositoryHosts } from "@ren/core/repository-hosts"
import { SpaceSettings } from "@ren/core/space/settings"
import { Task } from "@ren/core/task"
import { TaskActivity } from "@ren/core/task/activity"
import { TaskComment } from "@ren/core/task/comment"
import { Usage } from "@ren/core/usage"
import { UsageIngestApi } from "@ren/protocol/usage-ingest"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpPlatform, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { Auth } from "./auth.js"
import { AgentHandler } from "./handlers/api/agent.js"
import { AppHandler } from "./handlers/api/app.js"
import { AppRegistryHandler } from "./handlers/api/app-registry.js"
import { AppProfileHandler, AppProfileReachHandler } from "./handlers/api/app-profile.js"
import { AgentMembershipHandler } from "./handlers/api/agent-membership.js"
import { ChatHandler } from "./handlers/api/chat.js"
import { CredentialHandler } from "./handlers/api/credential.js"
import { CredentialConnectHandler } from "./handlers/api/credential-connect.js"
import { OAuthAppHandler } from "./handlers/api/oauth-app.js"
import { ChannelConnectHandler, ChannelInstallHandler, ChannelMappingHandler } from "./handlers/api/channel-install.js"
import { RepositoryHandler } from "./handlers/api/repository.js"
import { SignInHandler } from "./handlers/api/sign-in.js"
import { OAuthSessionHandler } from "./handlers/api/oauth-session.js"
import { OAuthRoutes } from "./oauth-routes.js"
import { ChannelRoutes } from "./channel-routes.js"
import { OAuthApps } from "@ren/core/oauth-apps"
import { CredentialRequirements } from "@ren/core/credential-requirements"
import { HealthHandler } from "./handlers/api/health.js"
import { InfraHandler } from "./handlers/api/infra.js"
import { InsightsHandler } from "./handlers/api/insights.js"
import { InvitationHandler } from "./handlers/api/invitation.js"
import { LabelHandler } from "./handlers/api/label.js"
import { MeHandler } from "./handlers/api/me.js"
import { MemoryHandler } from "./handlers/api/memory.js"
import { DriveHandler } from "./handlers/api/drive.js"
import { EnvironmentTemplateHandler, EnvironmentProviderHandler } from "./handlers/api/environment-template.js"
import { OrganizationSettingsHandler } from "./handlers/api/organization-settings.js"
import { RenInferenceHandler } from "./handlers/api/ren-inference.js"
import { ScheduleHandler, ScheduleRunHandler } from "./handlers/api/schedule.js"
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
import { UsageAuthenticationLayer, UsageHandler } from "./handlers/usage.js"
import { ActiveOrganizationLayer } from "./middleware/active-organization.js"
import { AuthenticationLayer } from "./middleware/authentication.js"
import { bodyLimit } from "./middleware/body-limit.js"
import { RenMcp } from "./ren-mcp.js"
import { SlackMcp } from "./slack-mcp.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
const AuthRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* router.add("*", "/auth/*", HttpEffect.fromWebHandler(auth.handler))
    yield* router.add("GET", "/.well-known/*", HttpEffect.fromWebHandler(auth.handler))
  }),
)

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return HttpMiddleware.cors({
      allowedOrigins: (origin) => auth.trustedOrigins.includes(origin),
      allowedHeaders: ["authorization", "content-type", Auth.consentOrganizationHeader],
      credentials: true,
    })
  }),
  { global: true },
)

const settingsAndAgents = Layer.mergeAll(SpaceSettings.layer, OrganizationSettings.layer, Agent.layer).pipe(
  Layer.provide(ReferenceCheck.layer),
  Layer.provide(RepositoryHosts.layer),
)

const schedules = Schedules.layer.pipe(
  Layer.provide(ScheduleTrigger.layerPostgres),
  Layer.provide(SessionRunner.layer),
  Layer.provide(BrainRegistry.layer),
)

// oxlint-disable-next-line ren/no-comments -- Api only (MCP may stream SSE); gzip only (Bun's brotli blocks the event loop).
const Compression = HttpRouter.middleware(
  Effect.gen(function* () {
    const platform = yield* HttpPlatform.HttpPlatform
    return (httpEffect) =>
      HttpMiddleware.compression({ algorithms: ["gzip"] })(httpEffect).pipe(
        Effect.provideService(HttpPlatform.HttpPlatform, platform),
      )
  }),
).layer

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
        MemoryHandler,
        DriveHandler,
        AgentHandler,
        AppHandler,
        AppProfileHandler,
        AppProfileReachHandler,
        AppRegistryHandler,
        AgentMembershipHandler,
        SessionHandler,
        ChatHandler,
        TaskHandler,
        TaskActivityHandler,
        TaskCommentHandler,
        LabelHandler,
        ScheduleHandler,
        ScheduleRunHandler,
        CredentialHandler,
        CredentialConnectHandler,
        OAuthSessionHandler,
        OAuthAppHandler,
        RenInferenceHandler,
        ChannelInstallHandler,
        ChannelMappingHandler,
        ChannelConnectHandler,
        RepositoryHandler,
        SignInHandler,
        InfraHandler,
        InsightsHandler,
      ]),
      Layer.provide([ActiveOrganizationLayer, AuthenticationLayer, Compression]),
      Layer.provide([
        Health.layer,
        Invitation.layer,
        Space.layer,
        SpaceMember.layer,
        EnvironmentTemplates.layer,
        SpaceEnvironmentTemplate.layer,
        Memory.layer,
        Insights.layer.pipe(Layer.provide(Space.layer)),
        settingsAndAgents,
        InfraSpecs.layer.pipe(
          Layer.provide([
            Space.layer,
            AgentMembership.layer,
            settingsAndAgents,
            App.layer,
            ChannelMappings.layer,
            schedules,
          ]),
        ),
        Layer.mergeAll(Task.layer, TaskActivity.layer, TaskComment.layer, Label.layer).pipe(
          Layer.provide(SessionRunner.layer),
          Layer.provide(BrainRegistry.layer),
        ),
        schedules,
        App.layer,
        AppRegistry.layer,
        AgentMembership.layer,
        Session.layer.pipe(Layer.provide(SessionRunner.layer), Layer.provide(BrainRegistry.layer)),
        OAuthApps.layer,
        ChannelInstalls.layer,
        RepositoryHosts.layer,
        ChannelMappings.layer,
        CredentialRequirements.layer,
      ]),
    ),
    HttpApiBuilder.layer(RenHostApi).pipe(
      Layer.provide([HostPullHandler, HostModelsHandler, HostEnvironmentsHandler, HostTokenHandler]),
      Layer.provide(Brains.hostAuthentication),
    ),
    HttpApiBuilder.layer(UsageIngestApi).pipe(
      Layer.provide(UsageHandler),
      Layer.provide(UsageAuthenticationLayer),
      Layer.provide(Usage.layer),
    ),
    AuthRoute,
    RenMcp.layer,
    SlackMcp.layer.pipe(Layer.provide(SlackBot.layer)),
    OAuthRoutes.layer,
    ChannelRoutes.layer.pipe(
      Layer.provide(Channels.layer),
      Layer.provide([Task.layer.pipe(Layer.provideMerge(SessionRunner.layer)), ChannelInstalls.layer]),
      Layer.provide(BrainRegistry.layer),
    ),
  ).pipe(Layer.provide(bodyLimit(1024 * 1024))),
  HttpApiBuilder.layer(SyncApi).pipe(
    Layer.provide(SyncHandler),
    Layer.provide([
      Brains.hostAuthentication,
      bodyLimit(Sync.maxBodyBytes),
      SessionSync.layer,
      ChannelTurns.layer.pipe(Layer.provide(SessionRunner.layer), Layer.provide(BrainRegistry.layer)),
      Task.layer.pipe(Layer.provide(SessionRunner.layer), Layer.provide(BrainRegistry.layer)),
    ]),
  ),
  Cors,
).pipe(Layer.provide(Auth.layer), Layer.provide(Access.layer))
