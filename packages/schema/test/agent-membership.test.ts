import { expect, test } from "bun:test"
import { Option } from "effect"
import { Agent } from "../src/agent.js"
import { AgentMembership } from "../src/agent-membership.js"

test("an owner entry's ID gives back its agent, and a membership row's ID gives none", () => {
  const agentId = Agent.ID.create()
  expect(AgentMembership.ownerAgent(AgentMembership.ofOwner(agentId))).toEqual(Option.some(agentId))
  expect(AgentMembership.ownerAgent(AgentMembership.ID.create())).toEqual(Option.none())
})
