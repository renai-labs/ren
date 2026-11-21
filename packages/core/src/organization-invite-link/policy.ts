export * as OrganizationInviteLinkPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import { SpacePolicy } from "../space/policy.js"

const resource = "organization-invite-link"

export const actions = {
  create: `${resource}.create`,
  list: `${resource}.list`,
  revoke: `${resource}.revoke`,
} as const

// oxlint-disable-next-line ren/no-comments -- Only owners and admins make, read and stop links that bring people into the organization.
export const documents = [
  {
    resource,
    rules: [
      {
        actions: [actions.create, actions.list, actions.revoke],
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
