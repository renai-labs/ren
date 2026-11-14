import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { testEffect } from "./lib/effect.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(ProfilesFixture.layer)

const page = { page: 1, pageSize: 50 }

// oxlint-disable-next-line ren/no-comments -- The example of profiles.md §7: app google with Acme (sales), Globex (finance), Org mail (every space), and Ana's and Bob's private profiles.
const org = Effect.fnUntraced(function* () {
  const profiles = yield* AppProfiles.Service
  const organizationId = yield* Seed.organization()
  const root = yield* ProfilesFixture.user(organizationId, "Root", "admin")
  const ana = yield* ProfilesFixture.user(organizationId, "Ana")
  const bob = yield* ProfilesFixture.user(organizationId, "Bob")
  const cy = yield* ProfilesFixture.user(organizationId, "Cy")
  const sales = yield* ProfilesFixture.space(ana, "Sales", [bob])
  const finance = yield* ProfilesFixture.space(bob, "Finance", [cy])
  const design = yield* ProfilesFixture.space(ana, "Design", [bob])
  const base = yield* ProfilesFixture.app(root, root.personal, "base", { requiredCredentials: [Seed.env("BASE_KEY")] })
  const google = yield* ProfilesFixture.app(root, root.personal, "google", {
    mcps: { gmail: ProfilesFixture.remote("Gmail") },
    dependsOn: ["base"],
  })
  const owned = yield* profiles.list(root, { ...page })
  yield* Effect.forEach(owned.items, (found) => profiles.delete(root, found.id))
  const acme = yield* ProfilesFixture.profile(root, {
    appId: google.id,
    slug: "acme",
    kind: "shared",
    spaceIds: [sales],
  })
  yield* ProfilesFixture.profile(root, { appId: google.id, slug: "globex", kind: "shared", spaceIds: [finance] })
  yield* ProfilesFixture.profile(root, { appId: google.id, slug: "org-mail", kind: "shared", allSpaces: true })
  yield* ProfilesFixture.profile(ana, { appId: google.id, slug: "ana", kind: "private" })
  yield* ProfilesFixture.profile(bob, { appId: google.id, slug: "bob", kind: "private" })
  const shared = yield* ProfilesFixture.profile(root, { appId: base.id, slug: "shared", kind: "shared", spaceIds: [] })
  return { organizationId, root, ana, bob, cy, sales, finance, design, google, base, acme, shared }
})

it.live("shared and private profiles; a second slug in one app fails; a custom app makes its owner-space profile", () =>
  Effect.gen(function* () {
    const profiles = yield* AppProfiles.Service
    const organizationId = yield* Seed.organization()
    const ana = yield* ProfilesFixture.user(organizationId, "Ana")
    const sales = yield* ProfilesFixture.space(ana, "Sales Team")
    const app = yield* ProfilesFixture.app(ana, sales, "mail", { mcps: { gmail: ProfilesFixture.remote("Gmail") } })
    const owned = (yield* profiles.list(ana, { ...page, appId: app.id })).items
    expect(
      owned.map((found) => ({ slug: found.slug, name: found.name, kind: found.kind, spaces: found.spaces })),
    ).toEqual([{ slug: "sales-team", name: "Sales Team", kind: "shared", spaces: [{ id: sales, name: "Sales Team" }] }])
    const mine = yield* ProfilesFixture.profile(ana, { appId: app.id, slug: "ana", kind: "private" })
    expect(mine).toMatchObject({ kind: "private", userId: ana.userId, spaces: [], allSpaces: false })
    expect(mine.items).toMatchObject([{ item: { mcp: "gmail" }, label: "MCP_GMAIL__ANA", status: "missing" }])
    const twice = yield* Effect.flip(ProfilesFixture.profile(ana, { appId: app.id, slug: "ana", kind: "shared" }))
    expect(twice._tag).toBe("Primitive.Conflict")
  }),
)

it.live(
  "reach: a shared space reaches the shared profiles that list it; a private space adds its owner's private profiles, and a shared profile only when it is listed there (private-spaces rules 10-13, PS5, PS9)",
  () =>
    Effect.gen(function* () {
      const found = yield* org()
      const apps = yield* App.Service
      const profiles = yield* AppProfiles.Service
      const reach = (spaceId: typeof found.sales) => ProfilesFixture.reach(found.organizationId, spaceId)
      expect(yield* reach(found.sales)).toEqual(["base/acme", "base/org-mail", "google/acme", "google/org-mail"])
      expect(yield* reach(found.finance)).toEqual(["base/globex", "base/org-mail", "google/globex", "google/org-mail"])
      expect(yield* reach(found.design)).toEqual(["base/org-mail", "google/org-mail"])
      expect(yield* reach(found.ana.personal)).toEqual(["google/ana", "base/org-mail", "google/org-mail"])
      expect(yield* reach(found.bob.personal)).toEqual(["google/bob", "base/org-mail", "google/org-mail"])
      expect((yield* Effect.flip(profiles.access(found.ana, found.acme.id, { add: [found.bob.personal] })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* Effect.flip(profiles.access(found.root, found.acme.id, { add: [found.ana.personal] })))._tag).toBe(
        "Primitive.Forbidden",
      )
      yield* profiles.access(found.ana, found.acme.id, { add: [found.ana.personal] })
      expect(yield* reach(found.ana.personal)).toEqual([
        "google/ana",
        "base/org-mail",
        "google/acme",
        "google/org-mail",
      ])
      yield* profiles.access(found.root, found.acme.id, { remove: [found.ana.personal] })
      expect(yield* reach(found.ana.personal)).toEqual(["google/ana", "base/org-mail", "google/org-mail"])
      yield* profiles.link(found.root, found.acme.id, { appId: found.base.id, profileId: found.shared.id })
      expect(yield* reach(found.sales)).toEqual([
        "base/acme",
        "base/org-mail",
        "base/shared",
        "google/acme",
        "google/org-mail",
      ])
      yield* apps.archive(found.root, found.google.id)
      expect(yield* reach(found.sales)).toEqual(["base/acme", "base/org-mail", "base/shared"])
    }),
)

it.live(
  "removing a shared profile from its last space deletes it when it has no credentials and keeps it when it has; a space the caller cannot see still counts",
  () =>
    Effect.gen(function* () {
      const found = yield* org()
      const profiles = yield* AppProfiles.Service
      const both = yield* ProfilesFixture.profile(found.ana, {
        appId: found.google.id,
        slug: "both",
        kind: "shared",
        spaceIds: [found.sales],
      })
      yield* profiles.access(found.root, both.id, { add: [found.finance] })
      yield* profiles.access(found.ana, both.id, { remove: [found.sales] })
      expect((yield* profiles.get(found.root, both.id)).spaces.map((space) => space.id)).toEqual([found.finance])
      yield* profiles.access(found.root, both.id, { remove: [found.finance] })
      expect((yield* Effect.flip(profiles.get(found.root, both.id)))._tag).toBe("Primitive.NotFound")
      const everywhere = yield* ProfilesFixture.profile(found.root, {
        appId: found.google.id,
        slug: "everywhere",
        kind: "shared",
        allSpaces: true,
      })
      yield* profiles.access(found.root, everywhere.id, { allSpaces: false })
      expect((yield* Effect.flip(profiles.get(found.root, everywhere.id)))._tag).toBe("Primitive.NotFound")
      const signedIn = yield* ProfilesFixture.profile(found.ana, {
        appId: found.google.id,
        slug: "signed-in",
        kind: "shared",
        spaceIds: [found.sales],
      })
      const credentialId = yield* ProfilesFixture.connect(found.organizationId, signedIn.id, "MCP_GMAIL__SIGNED_IN")
      const kept = yield* profiles.access(found.ana, signedIn.id, { remove: [found.sales] })
      expect(kept).toMatchObject({ id: signedIn.id, spaces: [], hiddenSpaces: 0 })
      expect((yield* profiles.get(found.ana, signedIn.id)).items.at(0)?.credentialId).toBe(credentialId)
      expect(yield* ProfilesFixture.reach(found.organizationId, found.sales)).toEqual([
        "base/acme",
        "base/org-mail",
        "google/acme",
        "google/org-mail",
      ])
    }),
)

it.live(
  "a member's list writes touch only their spaces, or add their own private space (AC15); get shows the hidden count; only admins set all_spaces",
  () =>
    Effect.gen(function* () {
      const found = yield* org()
      const profiles = yield* AppProfiles.Service
      const both = yield* ProfilesFixture.profile(found.root, {
        appId: found.google.id,
        slug: "both",
        kind: "shared",
        spaceIds: [found.sales, found.finance],
      })
      const seen = yield* profiles.get(found.ana, both.id)
      expect({ spaces: seen.spaces.map((space) => space.id), hidden: seen.hiddenSpaces }).toEqual({
        spaces: [found.sales],
        hidden: 1,
      })
      expect(seen).toMatchObject({
        canAccess: true,
        canShareEverySpace: false,
        canAdd: ["ownPrivate"],
        canRemove: ["ownPrivate"],
      })
      expect(yield* profiles.get(found.root, both.id)).toMatchObject({ canAccess: true, canShareEverySpace: true })
      const mine = yield* ProfilesFixture.profile(found.ana, {
        appId: found.google.id,
        slug: "ana-shared",
        kind: "shared",
        spaceIds: [found.sales],
      })
      expect((yield* Effect.flip(profiles.access(found.ana, mine.id, { add: [found.finance] })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect(mine).toMatchObject({ canAccess: true, canShareEverySpace: false })
      const added = yield* profiles.access(found.ana, mine.id, { add: [found.design], remove: [found.sales] })
      expect(added.spaces.map((space) => space.id)).toEqual([found.design])
      expect((yield* Effect.flip(profiles.access(found.ana, mine.id, { allSpaces: true })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* profiles.access(found.root, mine.id, { allSpaces: true })).allSpaces).toBe(true)
    }),
)

it.live(
  "a member who sees a shared profile deletes it; promote keeps credentials and labels and lists only the space it is for",
  () =>
    Effect.gen(function* () {
      const found = yield* org()
      const profiles = yield* AppProfiles.Service
      const database = yield* Database.Service
      expect((yield* profiles.delete(found.bob, found.acme.id)).id).toBe(found.acme.id)
      expect((yield* Effect.flip(profiles.get(found.bob, found.acme.id)))._tag).toBe("Primitive.NotFound")
      const mine = (yield* profiles.list(found.ana, { ...page, appId: found.google.id })).items.find(
        (profile) => profile.slug === "ana",
      )
      if (!mine) return yield* Effect.die(new Error("expected Ana's private profile"))
      const credentialId = yield* ProfilesFixture.connect(found.organizationId, mine.id, "MCP_GMAIL__ANA")
      expect((yield* Effect.flip(profiles.promote(found.bob, mine.id, { spaceId: found.sales })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(profiles.promote(found.ana, mine.id, { spaceId: found.finance })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* profiles.get(found.ana, mine.id)).kind).toBe("private")
      const promoted = yield* profiles.promote(found.ana, mine.id, { spaceId: found.sales })
      expect(promoted).toMatchObject({ id: mine.id, kind: "shared", userId: null })
      expect(promoted.spaces.map((space) => space.id)).toEqual([found.sales])
      const row = (yield* database.db
        .select()
        .from(Database.Schema.credential)
        .where(eq(Database.Schema.credential.id, credentialId))).at(0)
      expect(row).toMatchObject({ profile_id: mine.id, label: "MCP_GMAIL__ANA" })
      expect(promoted.items.at(0)).toMatchObject({ credentialId, label: "MCP_GMAIL__ANA" })
    }),
)

it.live("two profiles of one app that reach the same space cannot have the same name", () =>
  Effect.gen(function* () {
    const found = yield* org()
    const profiles = yield* AppProfiles.Service
    const taken = <R>(effect: Effect.Effect<unknown, { readonly _tag: string; readonly message: string }, R>) =>
      Effect.flip(effect).pipe(Effect.map((error) => ({ tag: error._tag, message: error.message })))
    expect(
      yield* taken(
        ProfilesFixture.profile(found.root, {
          appId: found.google.id,
          slug: "acme-2",
          name: " ACME ",
          kind: "shared",
          spaceIds: [found.sales],
        }),
      ),
    ).toEqual({ tag: "Primitive.Conflict", message: "An account named “ACME” is already in Sales." })
    const other = yield* ProfilesFixture.profile(found.root, {
      appId: found.google.id,
      slug: "acme-2",
      name: "acme",
      kind: "shared",
      spaceIds: [found.finance],
    })
    expect((yield* taken(profiles.access(found.root, other.id, { add: [found.sales] }))).tag).toBe("Primitive.Conflict")
    expect((yield* taken(profiles.update(found.root, other.id, { name: "org-mail" }))).tag).toBe("Primitive.Conflict")
    expect(
      (yield* taken(
        ProfilesFixture.profile(found.ana, { appId: found.google.id, slug: "ana-2", name: "ana", kind: "private" }),
      )).tag,
    ).toBe("Primitive.Conflict")
    yield* ProfilesFixture.profile(found.ana, {
      appId: found.google.id,
      slug: "sales-ana",
      name: "ana",
      kind: "shared",
      spaceIds: [found.sales],
    })
    const mine = (yield* profiles.list(found.ana, { ...page, appId: found.google.id })).items.find(
      (profile) => profile.slug === "ana",
    )
    if (!mine) return yield* Effect.die(new Error("expected Ana's private profile"))
    expect((yield* taken(profiles.promote(found.ana, mine.id, { spaceId: found.sales }))).tag).toBe(
      "Primitive.Conflict",
    )
    expect((yield* profiles.promote(found.ana, mine.id, { spaceId: found.design })).spaces).toEqual([
      { id: found.design, name: "Design" },
    ])
  }),
)

it.live(
  "a shared profile cannot link a private profile; a dependency app without items is reached with no profile",
  () =>
    Effect.gen(function* () {
      const found = yield* org()
      const profiles = yield* AppProfiles.Service
      yield* profiles.access(found.root, found.shared.id, { add: [found.sales] })
      const privateBase = yield* ProfilesFixture.profile(found.ana, {
        appId: found.base.id,
        slug: "mine",
        kind: "private",
      })
      expect(
        (yield* Effect.flip(
          profiles.link(found.root, found.acme.id, { appId: found.base.id, profileId: privateBase.id }),
        ))._tag,
      ).toBe("Primitive.Forbidden")
      const tools = yield* ProfilesFixture.app(found.root, found.root.personal, "tools", {
        skills: { notes: Seed.skill("Notes") },
      })
      const docs = yield* ProfilesFixture.app(found.root, found.root.personal, "docs", {
        mcps: { search: ProfilesFixture.remote("Search", { type: "none" }) },
        dependsOn: ["tools"],
      })
      yield* ProfilesFixture.profile(found.root, {
        appId: docs.id,
        slug: "all",
        kind: "shared",
        spaceIds: [found.design],
      })
      const catalog = (yield* ProfilesFixture.catalog(found.organizationId, found.design)).catalog
      expect(catalog.apps.map((app) => app.appSlug)).toEqual(["base", "docs", "google", "tools"])
      expect(catalog.skills.map((skill) => `${skill.appSlug}/${skill.slug}`)).toEqual(["tools/notes"])
      expect(catalog.mcps.map((mcp) => mcp.server)).toEqual(["search"])
      expect(catalog.apps.at(3)?.appId).toEqual(tools.id)
    }),
)

it.live(
  "an app added to a space brings every app it depends on, through apps without sign-ins, as accounts of their own; one already there is kept",
  () =>
    Effect.gen(function* () {
      const profiles = yield* AppProfiles.Service
      const organizationId = yield* Seed.organization()
      const root = yield* ProfilesFixture.user(organizationId, "Root", "admin")
      const ana = yield* ProfilesFixture.user(organizationId, "Ana")
      const team = yield* ProfilesFixture.space(root, "Team", [ana])
      const other = yield* ProfilesFixture.space(root, "Other")
      yield* ProfilesFixture.app(root, other, "mail", { mcps: { mail: ProfilesFixture.remote("Mail") } })
      yield* ProfilesFixture.app(root, other, "notes", { skills: { notes: Seed.skill("Notes") }, dependsOn: ["mail"] })
      const docs = yield* ProfilesFixture.app(root, other, "docs", { skills: { docs: Seed.skill("Docs") } })
      yield* ProfilesFixture.profile(root, { appId: docs.id, slug: "kept", kind: "shared", spaceIds: [team] })
      const suite = yield* ProfilesFixture.app(root, other, "suite", {
        skills: { guide: Seed.skill("Guide") },
        dependsOn: ["notes", "docs"],
      })
      yield* ProfilesFixture.profile(root, {
        appId: suite.id,
        slug: "sales",
        name: "Sales",
        kind: "shared",
        spaceIds: [team],
      })
      expect(yield* ProfilesFixture.reach(organizationId, team)).toEqual([
        "docs/kept",
        "mail/sales",
        "notes/sales",
        "suite/sales",
      ])
      const mail = (yield* profiles.list(root, { ...page, spaceId: team })).items.find(
        (found) => found.appSlug === "mail",
      )
      expect(mail).toMatchObject({ name: "Sales", kind: "shared" })
      if (!mail) return
      yield* ProfilesFixture.connect(organizationId, mail.id, "MCP_MAIL__SALES")
      expect((yield* ProfilesFixture.catalog(organizationId, team)).catalog.mcps.map((mcp) => mcp.server)).toEqual([
        "mail__sales",
      ])
      yield* ProfilesFixture.profile(ana, { appId: suite.id, slug: "ana", kind: "private" })
      expect(yield* ProfilesFixture.reach(organizationId, ana.personal)).toEqual([
        "docs/ana",
        "mail/ana",
        "notes/ana",
        "suite/ana",
      ])
    }),
)

it.live(
  "an app added to another space or to every space installs its apps there too, numbered when the name is taken",
  () =>
    Effect.gen(function* () {
      const profiles = yield* AppProfiles.Service
      const organizationId = yield* Seed.organization()
      const root = yield* ProfilesFixture.user(organizationId, "Root", "admin")
      const team = yield* ProfilesFixture.space(root, "Team")
      const design = yield* ProfilesFixture.space(root, "Design")
      const fresh = yield* ProfilesFixture.space(root, "Fresh")
      const other = yield* ProfilesFixture.space(root, "Other")
      const mail = yield* ProfilesFixture.app(root, other, "mail", { mcps: { mail: ProfilesFixture.remote("Mail") } })
      yield* ProfilesFixture.profile(root, {
        appId: mail.id,
        slug: "sales",
        name: "Sales",
        kind: "shared",
        spaceIds: [other],
      })
      const suite = yield* ProfilesFixture.app(root, other, "suite", {
        skills: { guide: Seed.skill("Guide") },
        dependsOn: ["mail"],
      })
      const added = yield* ProfilesFixture.profile(root, {
        appId: suite.id,
        slug: "sales",
        name: "Sales",
        kind: "shared",
        spaceIds: [team],
      })
      yield* profiles.access(root, added.id, { add: [design] })
      yield* profiles.access(root, added.id, { allSpaces: true })
      expect(yield* ProfilesFixture.reach(organizationId, design)).toEqual([
        "mail/sales-3",
        "mail/sales-4",
        "suite/sales",
      ])
      expect(yield* ProfilesFixture.reach(organizationId, fresh)).toEqual(["mail/sales-4", "suite/sales"])
      expect(
        (yield* profiles.list(root, { ...page, appId: mail.id })).items.map((found) => [found.slug, found.name]),
      ).toEqual([
        ["other", "Other"],
        ["sales", "Sales"],
        ["sales-2", "Sales 2"],
        ["sales-3", "Sales 3"],
        ["sales-4", "Sales 4"],
      ])
    }),
)
