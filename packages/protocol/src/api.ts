import { HttpApi, OpenApi } from "effect/http-api"
import { EnvironmentTemplateGroup } from "./groups/environment-template.js"
import { EnvironmentProviderGroup } from "./groups/environment-provider.js"
import { HealthGroup } from "./groups/health.js"
import { InvitationGroup } from "./groups/invitation.js"
import { MeGroup } from "./groups/me.js"
import { SpaceGroup } from "./groups/space.js"
import { SpaceEnvironmentTemplateGroup } from "./groups/space-environment-template.js"
import { SpaceMemberGroup } from "./groups/space-member.js"

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(MeGroup)
  .add(InvitationGroup)
  .add(SpaceGroup)
  .add(SpaceMemberGroup)
  .add(EnvironmentTemplateGroup)
  .add(EnvironmentProviderGroup)
  .add(SpaceEnvironmentTemplateGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
