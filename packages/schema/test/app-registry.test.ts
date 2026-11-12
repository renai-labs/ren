import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AppRegistry } from "../src/app-registry.js"

const publication = (tools: Record<string, unknown>) =>
  Schema.decodeUnknownExit(AppRegistry.Publication)({
    slug: "docs",
    name: "Docs",
    description: "Read docs",
    mcps: {
      docs: {
        name: "Docs",
        description: "Search the docs",
        transport: { type: "remote", url: "https://docs.example.com/mcp" },
        auth: { type: "none" },
      },
    },
    listing: { tools },
  })

describe("AppRegistry.Publication", () => {
  test("a listing names tools only for the app's own MCPs", () => {
    expect(publication({ docs: [{ name: "search", description: "Search" }] })._tag).toBe("Success")
    expect(publication({ other: [{ name: "search", description: "Search" }] })._tag).toBe("Failure")
  })
})
