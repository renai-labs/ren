export * as AgentPolicy from "./policy.js"

import { Agent } from "@ren/schema/agent"
import { AgentMembership } from "@ren/schema/agent-membership"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = {
  ownerMember: "agent.ownerMember",
  spaceMember: "agent.spaceMember",
  targetMember: "target.spaceMember",
} as const

const every = SpacePolicy.organizationRoles

// oxlint-disable-next-line ren/no-comments -- access §7: agents belong to their owner space.
export const documents = [
  {
    resource: Agent.definition.name,
    rules: [
      {
        actions: Primitive.actions(Agent.definition, ["list", "get"]),
        effect: "allow",
        roles: every,
        when: [facts.spaceMember],
      },
      {
        actions: Primitive.actions(Agent.definition, ["create"]),
        effect: "allow",
        roles: every,
        when: [facts.targetMember],
      },
      {
        actions: Primitive.actions(Agent.definition, ["update", "archive"]),
        effect: "allow",
        roles: every,
        when: [facts.ownerMember],
      },
      {
        actions: Primitive.actions(Agent.definition, ["transferOwnership"]),
        effect: "allow",
        roles: every,
        when: [facts.ownerMember, facts.targetMember],
      },
    ],
  },
  {
    resource: AgentMembership.definition.name,
    rules: [
      {
        actions: Primitive.actions(AgentMembership.definition, ["list"]),
        effect: "allow",
        roles: every,
        when: [facts.spaceMember],
      },
      {
        actions: Primitive.actions(AgentMembership.definition, ["create"]),
        effect: "allow",
        roles: every,
        when: [facts.ownerMember, facts.targetMember],
      },
      {
        actions: Primitive.actions(AgentMembership.definition, ["archive"]),
        effect: "allow",
        roles: every,
        when: [facts.targetMember],
      },
      {
        actions: Primitive.actions(AgentMembership.definition, ["archive"]),
        effect: "allow",
        roles: every,
        when: [facts.ownerMember],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Holds {
  readonly isOwnerMember: boolean
  readonly isSpaceMember: boolean
  readonly isTargetMember?: boolean
}

export const resource = (holds: Holds): Access.Resource => ({
  facts: [
    ...(holds.isOwnerMember ? [facts.ownerMember] : []),
    ...(holds.isSpaceMember ? [facts.spaceMember] : []),
    ...(holds.isTargetMember ? [facts.targetMember] : []),
  ],
})
