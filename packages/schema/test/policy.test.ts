import { describe, expect, test } from "bun:test"
import { Policy } from "../src/policy.js"
import { Schema } from "effect"

const statement = {
  id: "member-edit",
  scope: { kind: "global" },
  effect: "allow",
  subjects: [{ kind: "everyone" }],
  actions: ["space.update"],
  resources: [{ kind: "space", id: "*" }],
  when: ["organization-member", "space-member"],
}

describe("Policy.Statement", () => {
  test("accepts the initial statement vocabulary", () => {
    expect(Schema.is(Policy.Statement)(statement)).toBe(true)
  })

  test("rejects unsupported vocabulary, empty selectors and malformed IDs", () => {
    for (const invalid of [
      { ...statement, effect: "ask" },
      { ...statement, actions: ["model.use"] },
      { ...statement, actions: ["space-member.update"] },
      { ...statement, actions: [] },
      { ...statement, subjects: [] },
      { ...statement, resources: [] },
      { ...statement, when: [] },
      { ...statement, when: ["unknown-condition"] },
      { ...statement, resources: [{ kind: "model", id: "*" }] },
      { ...statement, resources: [{ kind: "space", id: "invalid" }] },
      { ...statement, scope: { kind: "space", id: "invalid" } },
      { ...statement, subjects: [{ kind: "user", id: "invalid" }] },
    ]) {
      expect(Schema.is(Policy.Statement)(invalid)).toBe(false)
    }
  })
})
