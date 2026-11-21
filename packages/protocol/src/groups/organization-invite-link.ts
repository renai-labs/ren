import { OrganizationInviteLink } from "@ren/schema/organization-invite-link"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { Mcp } from "../mcp.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const OrganizationInviteLinkGroup = HttpApiGroup.make("organization-invite-link")
  .add(
    HttpApiEndpoint.post("organization-invite-link.create", "/organization-invite-links", {
      payload: OrganizationInviteLink.CreateInput,
      success: OrganizationInviteLink.Info,
      error: [ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "organization-invite-link.create",
        summary: "Create an organization invite link",
        description:
          "Make a link that brings anyone who opens it into the organization as a member, and into the chosen shared spaces. Owners and admins only. The organization’s first space is always on the link.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("organization-invite-link.list", "/organization-invite-links", {
      success: OrganizationInviteLink.List,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "organization-invite-link.list",
        summary: "List organization invite links",
        description: "Return the links that still work. Owners and admins only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("organization-invite-link.revoke", "/organization-invite-links/:id", {
      params: { id: OrganizationInviteLink.ID },
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "organization-invite-link.revoke",
        summary: "Revoke an organization invite link",
        description: "Stop a link. People who already joined with it stay. Owners and admins only.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "organization-invite-link" }))

const token = { token: OrganizationInviteLink.Token }

export const OrganizationJoinLinkGroup = HttpApiGroup.make("organization-join-link")
  .add(
    HttpApiEndpoint.get("organization-join-link.preview", "/organization-join-links/:token/preview", {
      params: token,
      success: OrganizationInviteLink.Preview,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "organization-join-link.preview",
          summary: "Preview an organization invite link",
          description:
            "Return the state of an invite link with its organization, inviter and spaces, without signing in. Unknown links return the `invalid` state.",
        }),
      )
      .annotate(Mcp.Hidden, "A person reads it on the join page before signing in; no use to an agent."),
  )
  .add(
    HttpApiEndpoint.post("organization-join-link.accept", "/organization-join-links/:token/accept", {
      params: token,
      success: OrganizationInviteLink.Joined,
      error: NotFoundError,
    })
      .middleware(Authentication)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "organization-join-link.accept",
          summary: "Join an organization with its invite link",
          description:
            "Add the signed-in person to the link’s organization as a member, and to the link’s shared spaces, in one step. A person already in the organization only gains the spaces. Accepting again is safe and finishes a join that stopped half way. Expired and revoked links return a `NotFoundError` and add no one.",
        }),
      )
      .annotate(Mcp.Hidden, "A person joins from the join page; an agent never joins an organization."),
  )
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "organization-join-link" }))
