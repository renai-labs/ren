export * as AgentPolicy from "./policy.js"

import { Agent } from "@ren/schema/agent"
import { AgentMembership } from "@ren/schema/agent-membership"
import { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"

const ownerMember = "agent.ownerMember"

const spaceMember = "agent.spaceMember"

const targetMember = "target.spaceMember"

const ownerAndTargetMember = "agent.ownerAndTargetMember"

const statements = (actions: ReadonlyArray<string>, relationship: string) => [
  { actions, roles: Auth.administratorRoles, on: Policy.everywhere },
  { actions, roles: Auth.Role.literals, on: relationship },
]

export const documents = [
  {
    primitive: Agent.definition.name,
    statements: [
      ...statements(Primitive.actions(Agent.definition, ["list", "get"]), spaceMember),
      ...statements(Primitive.actions(Agent.definition, ["create"]), targetMember),
      ...statements(Primitive.actions(Agent.definition, ["update", "archive"]), ownerMember),
      ...statements(Primitive.actions(Agent.definition, ["transferOwnership"]), ownerAndTargetMember),
    ],
  },
  {
    primitive: AgentMembership.definition.name,
    statements: [
      ...statements(Primitive.actions(AgentMembership.definition, ["list"]), spaceMember),
      ...statements(Primitive.actions(AgentMembership.definition, ["create"]), ownerAndTargetMember),
      ...statements(Primitive.actions(AgentMembership.definition, ["archive"]), targetMember),
      {
        actions: Primitive.actions(AgentMembership.definition, ["archive"]),
        roles: Auth.Role.literals,
        on: ownerMember,
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
  relationships: [
    ...(holds.isOwnerMember ? [ownerMember] : []),
    ...(holds.isSpaceMember ? [spaceMember] : []),
    ...(holds.isTargetMember ? [targetMember] : []),
    ...(holds.isOwnerMember && holds.isTargetMember ? [ownerAndTargetMember] : []),
  ],
})
