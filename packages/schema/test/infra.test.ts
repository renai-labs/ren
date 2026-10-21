import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Infra } from "../src/infra.js"

const agent = { description: "Writes the code." }

const decode = (spaces: Record<string, unknown>) =>
  Schema.decodeUnknownExit(Infra.Spec)({ org: { settings: {} }, spaces })

describe("Infra.Spec", () => {
  test("a space uses an agent that another space owns", () => {
    const exit = decode({
      engineering: { name: "Engineering", agents: { build: agent } },
      support: { name: "Support", uses: { agents: ["build"] } },
    })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("rejects an agent that two spaces define", () => {
    const exit = decode({
      engineering: { name: "Engineering", agents: { build: agent } },
      support: { name: "Support", agents: { build: agent } },
    })
    expect(String(exit)).toContain('Agent "build" is defined in engineering and support.')
  })

  test("rejects a use of an agent that no space defines", () => {
    const exit = decode({ support: { name: "Support", uses: { agents: ["build"] } } })
    expect(String(exit)).toContain('Space "support" uses agent "build", which no space defines.')
  })

  test("rejects a use of an agent that the space owns", () => {
    const exit = decode({ engineering: { name: "Engineering", agents: { build: agent }, uses: { agents: ["build"] } } })
    expect(String(exit)).toContain('Space "engineering" owns agent "build", so it does not list it in uses.')
  })
})
