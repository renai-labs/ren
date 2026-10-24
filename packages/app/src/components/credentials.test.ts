import { describe, expect, test } from "bun:test"
import { Credentials } from "./credentials.js"

describe("Credentials", () => {
  test("hosts are split on commas, spaces and new lines, lower-cased, and kept once", () => {
    expect(Credentials.hosts(" API.stripe.com, *.stripe.com\napi.stripe.com  ")).toEqual([
      "api.stripe.com",
      "*.stripe.com",
    ])
    expect(Credentials.hosts("  ")).toEqual([])
  })

  test("an MCP credential is one whose label starts with MCP_", () => {
    expect(Credentials.group("MCP_META_ADS__ACME")).toBe("mcp")
    expect(Credentials.group("STRIPE_API_KEY")).toBe("other")
  })

  test("the owner reads as the org, the space's name, You or Personal", () => {
    const spaces = new Map([["spc_1", "Team"]])
    expect(Credentials.ownerLabel({ kind: "org" }, spaces, "usr_1")).toBe("Organization")
    expect(Credentials.ownerLabel({ kind: "space", spaceId: "spc_1" }, spaces, "usr_1")).toBe("Team")
    expect(Credentials.ownerLabel({ kind: "space", spaceId: "spc_2" }, spaces, "usr_1")).toBe("A space")
    expect(Credentials.ownerLabel({ kind: "person", userId: "usr_1" }, spaces, "usr_1")).toBe("You")
    expect(Credentials.ownerLabel({ kind: "person", userId: "usr_2" }, spaces, "usr_1")).toBe("Personal")
  })

  test("only pasted keys can be copied", () => {
    expect(Credentials.canCopy({ type: "key", account: null })).toBe(true)
    expect(Credentials.canCopy({ type: "oauth", account: null })).toBe(false)
    expect(Credentials.canCopy({ type: "key", account: { userId: "usr_1", name: "Ada" } })).toBe(false)
  })
})
