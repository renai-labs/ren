import { describe, expect, test } from "bun:test"
import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { Profiles } from "./profiles.js"

const item = (name: string, status: AppProfileItem["status"], optional = false): AppProfileItem => ({
  item: { mcp: name.toLowerCase() },
  kind: "oauth",
  label: `MCP_${name.toUpperCase()}__ACME`,
  name,
  status,
  optional,
  credentialId: null,
  holder: null,
})

const profile = (items: ReadonlyArray<AppProfileItem>): AppProfileInfo => ({
  id: "apf_1",
  appId: "app_1",
  appSlug: "google",
  slug: "acme",
  name: "Acme client",
  kind: "shared",
  userId: null,
  allSpaces: false,
  spaces: [],
  hiddenSpaces: 0,
  canAccess: false,
  canShareEverySpace: false,
  canAdd: [],
  canRemove: [],
  links: [],
  items: [...items],
  unused: [],
  oauthApps: [],
  skipped: [],
  createdBy: null,
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
})

describe("the profile dialog (P12, P32, §9 rule 6)", () => {
  test("from a shared space only Shared is offered, whatever its member count; from a private space or the Apps page both are", () => {
    expect(Profiles.kinds({ kind: "shared" })).toEqual(["shared"])
    expect(Profiles.kinds({ kind: "private" })).toEqual(["shared", "private"])
    expect(Profiles.kinds(undefined)).toEqual(["shared", "private"])
  })

  test("the account notice names the spaces the person sees, counts the others, and says every space for all_spaces", () => {
    const base = { kind: "shared" as const, allSpaces: false, hiddenSpaces: 2 }
    expect(Profiles.audience({ ...base, spaces: [{ name: "sales" }] })).toBe(
      "Everyone in sales and 2 other spaces can use this account.",
    )
    expect(Profiles.audience({ ...base, allSpaces: true, spaces: [] })).toBe(
      "Everyone in the organization can use this account.",
    )
    expect(Profiles.audience({ ...base, kind: "private", spaces: [] })).toContain("Only you")
  })
})

describe("the composer pill (P15)", () => {
  test("two gaps show 2 not connected; a connect clears one; an optional item is never a gap", () => {
    const before = [profile([item("Gmail", "missing"), item("Drive", "reconnect"), item("Docs", "missing", true)])]
    expect(Profiles.gapLabel(before)).toBe("2 not connected")
    const after = [profile([item("Gmail", "ok"), item("Drive", "reconnect"), item("Docs", "missing", true)])]
    expect(Profiles.gapLabel(after)).toBe("1 not connected")
    expect(Profiles.gapLabel([profile([item("Gmail", "ok")])])).toBeUndefined()
  })
})
