export * as DrivePolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

const resource = "drive"

export const actions = { read: `${resource}.read`, write: `${resource}.write` } as const

const facts = {
  organization: "drive.organization",
  space: "drive.space",
  member: SpacePolicy.facts.member,
  agent: "drive.agent",
} as const

export const documents = [
  {
    resource,
    rules: [
      {
        actions: [actions.read, actions.write],
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.organization],
      },
      {
        actions: [actions.read, actions.write],
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.space, facts.member],
      },
      {
        actions: [actions.read, actions.write],
        effect: "deny",
        roles: SpacePolicy.organizationRoles,
        when: [facts.agent],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization = (options: { readonly isAgent: boolean }): Access.Resource => ({
  facts: [facts.organization, ...(options.isAgent ? [facts.agent] : [])],
})

export const space = (options: { readonly isMember: boolean; readonly isAgent: boolean }): Access.Resource => ({
  facts: [facts.space, ...(options.isMember ? [facts.member] : []), ...(options.isAgent ? [facts.agent] : [])],
})
