import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { App } from "../src/app.js"

const official = {
  name: "Kernel",
  description: "Cloud browsers.",
  transport: { type: "remote", url: "https://mcp.onkernel.com/mcp" },
  auth: { type: "oauth", tokenEndpointAuth: "none" },
}

const managed = (fields: Record<string, unknown> = {}) => ({
  name: "Kernel",
  description: "Cloud browsers, paid with Ren credits.",
  transport: { type: "managed", server: "kernel", replaces: "kernel" },
  auth: { type: "none" },
  ...fields,
})

const decode = (mcps: Record<string, unknown>) =>
  Schema.decodeUnknownExit(App.Declaration)({ name: "Kernel", description: "Cloud browsers.", mcps })

describe("App.Declaration", () => {
  test("a managed MCP has auth none and replaces an MCP of its app that has auth", () => {
    expect(Exit.isSuccess(decode({ kernel: official, "kernel-managed": managed() }))).toBe(true)
    expect(String(decode({ kernel: official, "kernel-managed": managed({ auth: official.auth }) }))).toContain(
      "A managed MCP has auth none.",
    )
    expect(String(decode({ "kernel-managed": managed() }))).toContain(
      'The managed MCP replaces "kernel", which is not an MCP of this app with auth.',
    )
    expect(String(decode({ kernel: { ...official, auth: { type: "none" } }, "kernel-managed": managed() }))).toContain(
      'The managed MCP replaces "kernel", which is not an MCP of this app with auth.',
    )
  })
})
