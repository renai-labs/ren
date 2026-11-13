import { Space } from "@ren/schema/space"
import { SpaceInviteLink } from "@ren/schema/space-invite-link"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { Mcp } from "../mcp.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const SpaceInviteLinkGroup = HttpApiGroup.make("space-invite-link")
  .add(
    HttpApiEndpoint.get("space-invite-link.get", "/spaces/:id/invite-link", {
      params: { id: Space.ID },
      success: SpaceInviteLink.Info,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "space-invite-link.get",
        summary: "Get a space’s invite link",
        description:
          "Return the space’s invite link and make it the first time. Anyone in the organization who opens the link joins the space. Only members of a shared space can read it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("space-invite-link.reset", "/spaces/:id/invite-link/reset", {
      params: { id: Space.ID },
      success: SpaceInviteLink.Info,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "space-invite-link.reset",
        summary: "Reset a space’s invite link",
        description: "Stop the space’s current invite link and return a new one. The old link no longer works.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "space-invite-link" }))

const token = { token: SpaceInviteLink.Token }

export const JoinLinkGroup = HttpApiGroup.make("join-link")
  .add(
    HttpApiEndpoint.get("join-link.preview", "/join-links/:token/preview", {
      params: token,
      success: SpaceInviteLink.Preview,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "join-link.preview",
          summary: "Preview a space invite link",
          description:
            "Return what the signed-in person sees when they open an invite link: whether they can join, are already in the space, or are outside its organization. Unknown and reset links return the `invalid` state.",
        }),
      )
      .annotate(Mcp.Hidden, "A person reads it on the join page; no use to an agent."),
  )
  .add(
    HttpApiEndpoint.post("join-link.accept", "/join-links/:token/accept", {
      params: token,
      success: SpaceInviteLink.Joined,
      error: [NotFoundError, ForbiddenError],
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "join-link.accept",
          summary: "Join a space with its invite link",
          description:
            "Add the signed-in person to the link’s space. Only people already in the space’s organization can join; anyone else gets a `ForbiddenError`. A person already in the space joins nothing and counts no use.",
        }),
      )
      .annotate(Mcp.Hidden, "A person joins from the join page; an agent never joins a space."),
  )
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "join-link" }))
