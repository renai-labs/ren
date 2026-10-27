import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Factory } from "../src/factory.js"
import { FactoryCheck } from "../src/factory-check.js"

describe("FactoryCheck.problems", () => {
  test.each([
    ["an agent twice", [{ agentId: "a" }, { agentId: "a" }]],
    ["an edge to an agent outside the factory", [{ agentId: "a", to: [{ agentId: "b" }] }]],
    ["an edge to itself", [{ agentId: "a", to: [{ agentId: "a" }] }]],
    ["an else with no max", [{ agentId: "a", to: [{ agentId: "b", else: "c" }] }, { agentId: "b" }, { agentId: "c" }]],
    ["an else that is the target", [{ agentId: "a", to: [{ agentId: "b", max: 1, else: "b" }] }, { agentId: "b" }]],
  ])("refuses %s", (_name, agents) => {
    expect(FactoryCheck.problems(Schema.decodeUnknownSync(Factory.Info)({ agents }))).not.toEqual([])
  })
})
