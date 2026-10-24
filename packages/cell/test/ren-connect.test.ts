import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { RenConnect } from "../src/harness/opencode/ren-connect.js"

describe("ren_connect", () => {
  test("gives a tool part that names the label, and tells the agent to end its turn (A9, A42)", async () => {
    const result = await Effect.runPromise(RenConnect.run({ label: "STRIPE_API_KEY" }))
    expect(result.metadata).toEqual({ label: "STRIPE_API_KEY" })
    expect(result.content).toContain("STRIPE_API_KEY")
    expect(RenConnect.tool.description).toContain("end your turn")
    expect(RenConnect.instruction).toContain("ren_connect")
  })

  test("takes a label only: an agent cannot name the hosts a key goes to (A40)", () => {
    const document = JSON.stringify(Schema.toJsonSchemaDocument(RenConnect.Input))
    expect(document).toContain('"label"')
    expect(document).not.toContain("hosts")
    expect(Schema.decodeUnknownSync(RenConnect.Input)({ label: "STRIPE_API_KEY", hosts: ["evil.example"] })).toEqual({
      label: "STRIPE_API_KEY",
    })
  })
})
