import { Agent } from "@ren/schema/agent"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const AgentGroup = Primitive.group(Agent.definition, "sdk", [
  Primitive.list(Agent.definition).annotate(Mcp.Tool, true),
  Primitive.get(Agent.definition).annotate(Mcp.Tool, true),
  Primitive.create(Agent.definition).annotate(Mcp.Tool, true),
  Primitive.update(Agent.definition).annotate(Mcp.Tool, true),
  Primitive.archive(Agent.definition),
  Primitive.action(Agent.definition, "transferOwnership"),
])
