export * as MemoryPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

const resource = "memory"

export const actions = { read: `${resource}.read`, write: `${resource}.write` } as const

const facts = {
  organization: "memory.organization",
  space: "memory.space",
  member: SpacePolicy.facts.member,
  agent: "memory.agent",
  elsewhere: "memory.elsewhere",
} as const

// oxlint-disable-next-line ren/no-comments -- memory M4 to M6: a person edits the memory they can read, admins edit the organization’s; an agent reads both and edits only its own space’s.
export const documents = [
  {
    resource,
    rules: [
      {
        actions: [actions.read],
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.organization],
      },
      {
        actions: [actions.write],
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [facts.organization],
      },
      {
        actions: [actions.read, actions.write],
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.space, facts.member],
      },
      {
        actions: [actions.write],
        effect: "deny",
        roles: SpacePolicy.organizationRoles,
        when: [facts.organization, facts.agent],
      },
      {
        actions: [actions.write],
        effect: "deny",
        roles: SpacePolicy.organizationRoles,
        when: [facts.space, facts.elsewhere],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization = (options: { readonly isAgent: boolean }): Access.Resource => ({
  facts: [facts.organization, ...(options.isAgent ? [facts.agent] : [])],
})

export const space = (options: { readonly isMember: boolean; readonly isElsewhere: boolean }): Access.Resource => ({
  facts: [facts.space, ...(options.isMember ? [facts.member] : []), ...(options.isElsewhere ? [facts.elsewhere] : [])],
})
