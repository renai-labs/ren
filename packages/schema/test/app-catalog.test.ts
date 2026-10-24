import { describe, expect, test } from "bun:test"
import { App } from "../src/app.js"
import { AppCatalog } from "../src/app-catalog.js"
import { AppProfile } from "../src/app-profile.js"

const appId = App.ID.create()

const mcp = (server: string, slug: string, profile: string | null): AppCatalog.McpEntry => ({
  appId,
  appSlug: "mail",
  slug,
  server,
  declaration: {
    name: "Gmail",
    description: "Reads mail.",
    transport: { type: "remote", url: "https://mail.example.com/mcp" },
    auth: profile ? { type: "oauth", tokenEndpointAuth: "none" } : { type: "none" },
    requiredCredentials: [],
  },
  profile: profile === null ? null : { id: AppProfile.ID.create(), slug: profile, name: profile, kind: "shared" },
  label: profile === null ? null : `MCP_${slug.toUpperCase()}__${profile.toUpperCase()}`,
})

const catalog = (mcps: ReadonlyArray<AppCatalog.McpEntry>): AppCatalog.Catalog => ({
  apps: [],
  mcps,
  skills: [],
  unavailable: [],
})

const naming = (reserved: ReadonlyArray<string> = []): AppCatalog.Naming => ({
  normalize: (slug) => slug,
  reserved: reserved.map((slug) => ({ kind: "mcps", slug, source: "OpenCode" })),
})

describe("AppCatalog.nameConflicts", () => {
  test("MCP names are keyed by server, so two profiles of one app do not clash (§8 rule 2)", () => {
    expect(
      AppCatalog.nameConflicts(
        catalog([mcp("gmail__acme", "gmail", "acme"), mcp("gmail__globex", "gmail", "globex")]),
        naming(),
      ),
    ).toEqual([])
    expect(
      AppCatalog.nameConflicts(
        catalog([mcp("gmail__acme", "gmail", "acme"), mcp("gmail__acme", "gmail", "acme")]),
        naming(),
      ),
    ).toHaveLength(1)
    expect(
      AppCatalog.nameConflicts(catalog([mcp("docs-search", "docs-search", null)]), naming(["docs-search"])),
    ).toHaveLength(1)
  })
})
