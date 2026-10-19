import { HttpApi, OpenApi } from "effect/http-api"
import { EnvironmentGroup } from "./groups/environment.js"
import { HandProviderGroup } from "./groups/hand-provider.js"
import { HealthGroup } from "./groups/health.js"
import { InvitationGroup } from "./groups/invitation.js"
import { MeGroup } from "./groups/me.js"
import { SpaceGroup } from "./groups/space.js"
import { SpaceEnvironmentGroup } from "./groups/space-environment.js"
import { SpaceMemberGroup } from "./groups/space-member.js"

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(MeGroup)
  .add(InvitationGroup)
  .add(SpaceGroup)
  .add(SpaceMemberGroup)
  .add(EnvironmentGroup)
  .add(HandProviderGroup)
  .add(SpaceEnvironmentGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
