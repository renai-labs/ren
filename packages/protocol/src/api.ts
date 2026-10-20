import { HttpApi, OpenApi } from "effect/http-api"
import { AgentGroup } from "./groups/agent.js"
import { AgentMembershipGroup } from "./groups/agent-membership.js"
import { EnvironmentTemplateGroup } from "./groups/environment-template.js"
import { EnvironmentProviderGroup } from "./groups/environment-provider.js"
import { HealthGroup } from "./groups/health.js"
import { InvitationGroup } from "./groups/invitation.js"
import { MeGroup } from "./groups/me.js"
import { OrganizationSettingsGroup } from "./groups/organization-settings.js"
import { SpaceGroup } from "./groups/space.js"
import { SpaceEnvironmentTemplateGroup } from "./groups/space-environment-template.js"
import { SpaceMemberGroup } from "./groups/space-member.js"
import { SpaceSettingsGroup } from "./groups/space-settings.js"

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
  .add(AgentMembershipGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
