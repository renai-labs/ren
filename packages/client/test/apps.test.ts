import { describe, expect, test } from "bun:test"
import { Apps, type AppProfileInfo } from "../src/index.js"

const item = (status: Apps.Item["status"], mcp = "github"): Apps.Item => ({
  item: { mcp },
  kind: "oauth",
  label: mcp.toUpperCase(),
  name: mcp,
  status,
  optional: false,
  credentialId: null,
  holder: null,
})

const profile = (input: Partial<AppProfileInfo> & { readonly id: string }): AppProfileInfo => ({
  appId: "app_1",
  appSlug: "github",
  slug: input.id,
  name: input.id,
  kind: "shared",
  userId: null,
  allSpaces: false,
  spaces: [],
  hiddenSpaces: 0,
  canAccess: true,
  canShareEverySpace: false,
  canAdd: ["joined"],
  canRemove: [],
  links: [],
  items: [item("ok")],
  unused: [],
  oauthApps: [],
  skipped: [],
  createdBy: null,
  createdAt: "",
  updatedAt: "",
  ...input,
})

const plain = { mcps: {} }
const managed: Pick<Apps.CatalogApp, "mcps"> = {
  mcps: {
    ren: { name: "Ren", description: "", transport: { type: "managed", server: "ren" }, auth: { type: "none" } },
  },
}
const space = { spaceId: "spc_1", private: false }

describe("Apps connect plan", () => {
  test("finishes the account in this space: an expired sign-in first, then one that is not signed in", () => {
    const expired = profile({ id: "a", spaces: [{ id: "spc_1", name: "Team" }], items: [item("reconnect")] })
    const open = profile({ id: "b", spaces: [{ id: "spc_1", name: "Team" }], items: [item("missing")] })
    expect(Apps.connectPlan({ app: plain, accounts: [open, expired], target: space, userId: "u" }).open?.id).toBe("a")
    expect(Apps.connectPlan({ app: plain, accounts: [open], target: space, userId: "u" }).open?.id).toBe("b")
    expect(Apps.nextSignIn(expired)?.status).toBe("reconnect")
    expect(Apps.nextSignIn(open)?.status).toBe("missing")
  })

  test("offers a connected account from elsewhere that the person may add, and none while the sign-in expired", () => {
    const elsewhere = profile({ id: "c", spaces: [{ id: "spc_2", name: "Other" }] })
    const locked = profile({ id: "d", spaces: [{ id: "spc_2", name: "Other" }], canAdd: [] })
    expect(Apps.connectPlan({ app: plain, accounts: [locked, elsewhere], target: space, userId: "u" }).reuse?.id).toBe(
      "c",
    )
    expect(Apps.connectPlan({ app: plain, accounts: [locked], target: space, userId: "u" }).reuse).toBeUndefined()
    const expired = profile({ id: "a", spaces: [{ id: "spc_1", name: "Team" }], items: [item("reconnect")] })
    expect(
      Apps.connectPlan({ app: plain, accounts: [expired, elsewhere], target: space, userId: "u" }).reuse,
    ).toBeUndefined()
  })

  test("a private account reaches only its owner's personal space and is added to a shared one by its owner", () => {
    const mine = profile({ id: "e", kind: "private", userId: "u", canAdd: [] })
    const personal = { spaceId: "spc_me", private: true }
    expect(Apps.reaches(mine, personal, "u")).toBe(true)
    expect(Apps.reaches(mine, personal, "other")).toBe(false)
    expect(Apps.usable(mine, space, "u")).toBe(true)
    expect(Apps.usable(mine, space, "other")).toBe(false)
  })

  test("Ren credits are offered while no account reaches the space", () => {
    expect(Apps.connectPlan({ app: managed, accounts: [], target: space, userId: "u" }).managed).toBe(true)
    expect(Apps.connectPlan({ app: plain, accounts: [], target: space, userId: "u" }).managed).toBe(false)
    const here = profile({ id: "f", spaces: [{ id: "spc_1", name: "Team" }], items: [item("missing")] })
    expect(Apps.connectPlan({ app: managed, accounts: [here], target: space, userId: "u" }).managed).toBe(false)
  })

  test("a sign-in that Ren cannot start has no next step", () => {
    const gated = profile({
      id: "g",
      items: [item("missing")],
      oauthApps: [{ name: "GitHub app", isConfigured: false }],
    })
    expect(Apps.nextSignIn(gated)).toBeUndefined()
  })

  test("a connection counts as better only when the status moves toward connected", () => {
    expect(Apps.improved("missing", "connected")).toBe(true)
    expect(Apps.improved("credits", "connected")).toBe(true)
    expect(Apps.improved("expired", "missing")).toBe(false)
    expect(Apps.improved("credits", "credits")).toBe(false)
  })
})
