import { Agent } from "@ren/schema/agent"
import { Primitive } from "../primitive.js"

export const AgentGroup = Primitive.group(Agent.definition, "sdk", [
  Primitive.list(Agent.definition),
  Primitive.get(Agent.definition),
  Primitive.create(Agent.definition),
  Primitive.update(Agent.definition),
  Primitive.archive(Agent.definition),
  Primitive.action(Agent.definition, "transferOwnership"),
])
