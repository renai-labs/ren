import { AgentMembership } from "@ren/schema/agent-membership"
import { Primitive } from "../primitive.js"

export const AgentMembershipGroup = Primitive.group(AgentMembership.definition, "sdk", [
  Primitive.list(AgentMembership.definition),
  Primitive.create(AgentMembership.definition),
  Primitive.archive(AgentMembership.definition),
])
