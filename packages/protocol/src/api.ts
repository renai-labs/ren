import { HttpApi, OpenApi } from "effect/http-api"
import { AgentGroup } from "./groups/agent.js"
import { AppGroup } from "./groups/app.js"
import { AppRegistryGroup, AppToolsGroup } from "./groups/app-registry.js"
import { ArtifactGroup } from "./groups/artifact.js"
import { AppProfileGroup, AppProfileReachGroup } from "./groups/app-profile.js"
import { AgentMembershipGroup } from "./groups/agent-membership.js"
import { BillingGroup } from "./groups/billing.js"
import { ChannelConnectGroup, ChannelInstallGroup, ChannelMappingGroup } from "./groups/channel-install.js"
import { RepositoryGroup } from "./groups/repository.js"
import { SignInGroup } from "./groups/sign-in.js"
import { ChatGroup } from "./groups/chat.js"
import { CredentialGroup } from "./groups/credential.js"
import { CredentialConnectGroup } from "./groups/credential-connect.js"
import { OAuthAppGroup } from "./groups/oauth-app.js"
import { OAuthSessionGroup } from "./groups/oauth-session.js"
import { DriveGroup } from "./groups/drive.js"
import { FilesGroup } from "./groups/files.js"
import { MachineTemplateGroup } from "./groups/machine-template.js"
import { MachineProviderGroup } from "./groups/machine-provider.js"
import { McpInspectGroup } from "./groups/mcp-inspect.js"
import { HealthGroup } from "./groups/health.js"
import { InfraGroup } from "./groups/infra.js"
import { InsightsGroup } from "./groups/insights.js"
import { InvitationGroup } from "./groups/invitation.js"
import { LabelGroup } from "./groups/label.js"
import { LinkGroup } from "./groups/link.js"
import { MeGroup } from "./groups/me.js"
import { MemoryGroup } from "./groups/memory.js"
import { OrganizationSettingsGroup } from "./groups/organization-settings.js"
import { RenInferenceGroup } from "./groups/ren-inference.js"
import { ScheduleGroup, ScheduleRunGroup } from "./groups/schedule.js"
import { WebhookGroup, WebhookRequestGroup } from "./groups/webhook.js"
import { OrganizationInviteLinkGroup, OrganizationJoinLinkGroup } from "./groups/organization-invite-link.js"
import { SessionGroup } from "./groups/session.js"
import { SpaceGroup } from "./groups/space.js"
import { SpaceJoinRequestGroup } from "./groups/space-join-request.js"
import { JoinLinkGroup, SpaceInviteLinkGroup } from "./groups/space-invite-link.js"
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
  .add(SpaceJoinRequestGroup)
  .add(SpaceInviteLinkGroup)
  .add(JoinLinkGroup)
  .add(OrganizationInviteLinkGroup)
  .add(OrganizationJoinLinkGroup)
  .add(MachineTemplateGroup)
  .add(MachineProviderGroup)
  .add(SpaceSettingsGroup)
  .add(OrganizationSettingsGroup)
  .add(MemoryGroup)
  .add(DriveGroup)
  .add(FilesGroup)
  .add(AgentGroup)
  .add(AppGroup)
  .add(AppProfileGroup)
  .add(AppProfileReachGroup)
  .add(AppRegistryGroup)
  .add(AppToolsGroup)
  .add(McpInspectGroup)
  .add(AgentMembershipGroup)
  .add(SessionGroup)
  .add(ChatGroup)
  .add(TaskGroup)
  .add(TaskCommentGroup)
  .add(TaskActivityGroup)
  .add(LinkGroup)
  .add(LabelGroup)
  .add(ScheduleGroup)
  .add(ScheduleRunGroup)
  .add(WebhookGroup)
  .add(WebhookRequestGroup)
  .add(ArtifactGroup)
  .add(CredentialGroup)
  .add(CredentialConnectGroup)
  .add(OAuthSessionGroup)
  .add(OAuthAppGroup)
  .add(RenInferenceGroup)
  .add(BillingGroup)
  .add(ChannelInstallGroup)
  .add(ChannelMappingGroup)
  .add(ChannelConnectGroup)
  .add(RepositoryGroup)
  .add(SignInGroup)
  .add(InfraGroup)
  .add(InsightsGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
