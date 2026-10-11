import { Invitation } from "@ren/schema/invitation"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"

export const InvitationGroup = HttpApiGroup.make("invitation")
  .add(
    HttpApiEndpoint.get("invitation.preview", "/api/invitations/:id/preview", {
      params: { id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)) },
      success: Invitation.Preview,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "invitation.preview",
        summary: "Preview an organization invitation",
        description:
          "Return the state of an invitation link with its organization and inviter, without signing in. Unknown invitations return the `invalid` state.",
      }),
    ),
  )
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "invitation" }))
