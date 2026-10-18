import { HttpApi, OpenApi } from "effect/http-api"
import { ChatGroup } from "./groups/chat.js"
import { HealthGroup } from "./groups/health.js"
import { InvitationGroup } from "./groups/invitation.js"
import { MeGroup } from "./groups/me.js"
import { SessionGroup } from "./groups/session.js"
import { SpaceGroup } from "./groups/space.js"
import { SpaceMemberGroup } from "./groups/space-member.js"

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(MeGroup)
  .add(InvitationGroup)
  .add(SpaceGroup)
  .add(SpaceMemberGroup)
  .add(SessionGroup)
  .add(ChatGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
