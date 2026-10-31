import { describe, expect, test } from "bun:test"
import { App } from "@ren/schema/app"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { AppProfile } from "@ren/schema/app-profile"
import { Option } from "effect"
import { AppSelection } from "../src/app/selection.js"
import { ProfilesFixture } from "./lib/profiles.js"

const kernel = App.ID.create()

const official = (profile: string): AppCatalog.McpEntry => ({
  appId: kernel,
  appSlug: "kernel",
  slug: "kernel",
  declaration: ProfilesFixture.remote("Kernel"),
  server: `kernel__${profile}`,
  profile: { id: AppProfile.ID.create(), slug: profile, name: profile, kind: "shared" },
  label: `MCP_KERNEL__${profile.toUpperCase()}`,
})

const candidate = (slug: string, replaces?: string): AppSelection.Candidate => ({
  appId: kernel,
  appSlug: "kernel",
  slug,
  declaration: ProfilesFixture.managed("Kernel", replaces),
})

const select = (input: Partial<Parameters<typeof AppSelection.select>[0]>) =>
  AppSelection.select({
    resolved: [],
    declared: [candidate("kernel-managed", "kernel")],
    integrationsUrl: Option.some(new URL("https://mcp.useren.ai/managed")),
    egress: true,
    ...input,
  })

describe("AppSelection.select", () => {
  test("with no connected official server, the managed server is on, at the integrations URL", () => {
    expect(select({})).toEqual({
      mcps: [
        {
          ...candidate("kernel-managed", "kernel"),
          server: "kernel-managed",
          profile: null,
          label: "INTEGRATIONS",
          url: "https://mcp.useren.ai/managed/kernel/mcp",
        },
      ],
      unavailable: [],
    })
  })

  test("a connected official server of the same app replaces it, even when another profile is not connected", () => {
    const connected = official("main")
    expect(select({ resolved: [connected] })).toEqual({ mcps: [connected], unavailable: [] })
  })

  test("without an integrations URL or an egress, it is unavailable", () => {
    const unavailable = (reason: AppCatalog.Unavailable["reason"]) => ({
      mcps: [],
      unavailable: [{ appSlug: "kernel", mcp: "kernel-managed", profile: null, reason }],
    })
    expect([select({ integrationsUrl: Option.none() }), select({ egress: false })]).toEqual([
      unavailable("integrations"),
      unavailable("egress"),
    ])
  })

  test("a managed MCP that replaces nothing stays on next to the official server", () => {
    const connected = official("main")
    expect(
      select({ resolved: [connected], declared: [candidate("search")] }).mcps.map((entry) => entry.server),
    ).toEqual(["kernel__main", "search"])
  })
})
