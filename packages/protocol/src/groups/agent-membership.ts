import { AgentMembership } from "@ren/schema/agent-membership"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const AgentMembershipGroup = Primitive.group(AgentMembership.definition, "sdk", [
  Primitive.list(AgentMembership.definition).annotate(Mcp.Tool, true),
  Primitive.create(AgentMembership.definition).annotate(Mcp.Tool, true),
  Primitive.archive(AgentMembership.definition).annotate(Mcp.Tool, true),
])
