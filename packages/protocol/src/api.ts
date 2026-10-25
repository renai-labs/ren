import { HttpApi, OpenApi } from "effect/http-api"
import { AgentGroup } from "./groups/agent.js"
import { AppGroup } from "./groups/app.js"
import { AppRegistryGroup } from "./groups/app-registry.js"
import { AppProfileGroup, AppProfileReachGroup } from "./groups/app-profile.js"
import { AgentMembershipGroup } from "./groups/agent-membership.js"
import { ChannelConnectGroup, ChannelInstallGroup } from "./groups/channel-install.js"
import { ChatGroup } from "./groups/chat.js"
import { CredentialGroup } from "./groups/credential.js"
import { CredentialConnectGroup } from "./groups/credential-connect.js"
import { OAuthAppGroup } from "./groups/oauth-app.js"
import { OAuthSessionGroup } from "./groups/oauth-session.js"
import { EnvironmentTemplateGroup } from "./groups/environment-template.js"
import { EnvironmentProviderGroup } from "./groups/environment-provider.js"
import { HealthGroup } from "./groups/health.js"
import { InvitationGroup } from "./groups/invitation.js"
import { LabelGroup } from "./groups/label.js"
import { MeGroup } from "./groups/me.js"
import { OrganizationSettingsGroup } from "./groups/organization-settings.js"
import { RenInferenceGroup } from "./groups/ren-inference.js"
import { SessionGroup } from "./groups/session.js"
import { SpaceGroup } from "./groups/space.js"
import { SpaceEnvironmentTemplateGroup } from "./groups/space-environment-template.js"
import { SpaceMemberGroup } from "./groups/space-member.js"
import { SpaceSettingsGroup } from "./groups/space-settings.js"
import { TaskGroup } from "./groups/task.js"
import { TaskActivityGroup } from "./groups/task-activity.js"
import { TaskCommentGroup } from "./groups/task-comment.js"

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(MeGroup)
  .add(InvitationGroup)
  .add(SpaceGroup)
  .add(SpaceMemberGroup)
  .add(EnvironmentTemplateGroup)
  .add(EnvironmentProviderGroup)
  .add(SpaceEnvironmentTemplateGroup)
  .add(SpaceSettingsGroup)
  .add(OrganizationSettingsGroup)
  .add(AgentGroup)
  .add(AppGroup)
  .add(AppProfileGroup)
  .add(AppProfileReachGroup)
  .add(AppRegistryGroup)
  .add(AgentMembershipGroup)
  .add(SessionGroup)
  .add(ChatGroup)
  .add(TaskGroup)
  .add(TaskCommentGroup)
  .add(TaskActivityGroup)
  .add(LabelGroup)
  .add(CredentialGroup)
  .add(CredentialConnectGroup)
  .add(OAuthSessionGroup)
  .add(OAuthAppGroup)
  .add(RenInferenceGroup)
  .add(ChannelInstallGroup)
  .add(ChannelConnectGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
