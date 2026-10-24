import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import type { App as AppSchema } from "@ren/schema/app"
import type { Mcp } from "@ren/schema/mcp"
import { eq } from "drizzle-orm"
import { Effect, Redacted, Schema } from "effect"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { AppRegistry } from "../src/app/registry.js"
import { AppResolve } from "../src/app/resolve.js"
import { Credentials } from "../src/credentials.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(ProfilesFixture.layer)

const page = { page: 1, pageSize: 50 }

const local: Mcp.Declaration = {
  name: "Sheets",
  description: "Edit sheets",
  transport: { type: "local", command: ["sheets-mcp"] },
  auth: { type: "none" },
  requiredCredentials: [Seed.env("SHEETS_KEY")],
}

const owned = Effect.fnUntraced(function* (actor: ProfilesFixture.User, appId: AppSchema.ID) {
  const profiles = yield* AppProfiles.Service
  yield* Effect.forEach((yield* profiles.list(actor, { ...page, appId })).items, (found) =>
    profiles.delete(actor, found.id),
  )
})

it.live("the catalog: server and label per profile, private first; a no-auth MCP once; unconnected items absent", () =>
  Effect.gen(function* () {
    const organizationId = yield* Seed.organization()
    const ana = yield* ProfilesFixture.user(organizationId, "Ana", "admin")
    const app = yield* ProfilesFixture.app(ana, ana.personal, "google", {
      mcps: {
        gmail: ProfilesFixture.remote("Gmail"),
        docs: ProfilesFixture.remote("Docs", { type: "none" }),
        sheets: local,
      },
      requiredCredentials: [Seed.env("PROJECT_ID")],
    })
    yield* owned(ana, app.id)
    const acme = yield* ProfilesFixture.profile(ana, { appId: app.id, slug: "acme", kind: "shared", allSpaces: true })
    const mine = yield* ProfilesFixture.profile(ana, { appId: app.id, slug: "ana", kind: "private", name: "Ana" })
    yield* ProfilesFixture.connect(organizationId, acme.id, "MCP_GMAIL__ACME")
    yield* ProfilesFixture.connect(organizationId, acme.id, "PROJECT_ID__ACME")
    yield* ProfilesFixture.connect(organizationId, mine.id, "MCP_GMAIL__ANA")
    yield* ProfilesFixture.connect(organizationId, mine.id, "SHEETS_KEY__ANA")
    const found = yield* ProfilesFixture.catalog(organizationId, ana.personal)
    expect(
      found.catalog.mcps.map((entry) => ({
        server: entry.server,
        label: entry.label,
        profile: entry.profile?.name ?? null,
        env: entry.env,
      })),
    ).toEqual([
      { server: "gmail__ana", label: "MCP_GMAIL__ANA", profile: "Ana", env: undefined },
      { server: "sheets__ana", label: null, profile: "Ana", env: { SHEETS_KEY: "ren:SHEETS_KEY__ANA" } },
      { server: "gmail__acme", label: "MCP_GMAIL__ACME", profile: "acme", env: undefined },
      { server: "docs", label: null, profile: null, env: undefined },
    ])
    expect(found.catalog.apps).toEqual([
      {
        appId: app.id,
        appSlug: "google",
        name: "google",
        profiles: [
          { slug: "ana", name: "Ana", kind: "private", env: { SHEETS_KEY: "SHEETS_KEY__ANA" } },
          { slug: "acme", name: "acme", kind: "shared", env: { PROJECT_ID: "PROJECT_ID__ACME" } },
        ],
      },
    ])
    expect(found.catalog.unavailable).toEqual([])
  }),
)

it.live("each mutation of §11 changes the fingerprint, and clears the egress cache where the table says so", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const profiles = yield* AppProfiles.Service
    const resolve = yield* AppResolve.Service
    const credentials = yield* Credentials.Service
    const members = yield* SpaceMember.Service
    const spaces = yield* Space.Service
    const registry = yield* AppRegistry.Service
    const provisioning = yield* SpaceProvisioning.Service
    const database = yield* Database.Service
    const organizationId = yield* Seed.organization()
    const root = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const ana = yield* ProfilesFixture.user(organizationId, "Ana")
    const bob = yield* ProfilesFixture.user(organizationId, "Bob")
    const cy = yield* ProfilesFixture.user(organizationId, "Cy")
    const sales = yield* ProfilesFixture.space(root, "Sales", [ana])
    const extra = yield* ProfilesFixture.space(root, "Extra", [ana])
    const app = yield* ProfilesFixture.app(root, root.personal, "mail", {
      mcps: { gmail: ProfilesFixture.remote("Gmail") },
      requiredCredentials: [Seed.env("MAIL_KEY")],
    })
    yield* owned(root, app.id)
    const base = yield* ProfilesFixture.app(root, root.personal, "base", {
      requiredCredentials: [Seed.env("BASE_KEY")],
    })
    yield* owned(root, base.id)
    yield* registry.publish({
      apps: [
        Schema.decodeUnknownSync(AppRegistry.Publication)({
          slug: "docs",
          name: "Docs",
          description: "Docs",
          listing: {},
        }),
      ],
    })
    const docs = yield* apps.get(root, "docs")
    yield* ProfilesFixture.profile(root, { appId: docs.id, slug: "all", kind: "shared", allSpaces: true })
    const scope = (yield* ProfilesFixture.catalog(organizationId, sales)).scope
    const personal = (yield* ProfilesFixture.catalog(organizationId, ana.personal)).scope
    yield* ProfilesFixture.catalog(organizationId, extra)
    const steps: Array<{ step: string; changed: boolean; cleared: boolean }> = []
    const measure = <R>(
      step: string,
      mutation: Effect.Effect<unknown, unknown, R>,
      watched: Credentials.Scope = scope,
    ) =>
      Effect.gen(function* () {
        const before = yield* resolve.revision(watched)
        ProfilesFixture.invalidated.length = 0
        yield* Effect.orDie(mutation)
        steps.push({
          step,
          changed: (yield* resolve.revision(watched)) !== before,
          cleared: ProfilesFixture.invalidated.length > 0,
        })
      })
    const acme = yield* ProfilesFixture.profile(root, { appId: app.id, slug: "acme", kind: "shared", spaceIds: [] })
    yield* measure("access add", profiles.access(root, acme.id, { add: [sales] }))
    yield* measure("rename", profiles.update(root, acme.id, { name: "Acme client" }))
    const linked = yield* ProfilesFixture.profile(root, { appId: base.id, slug: "b", kind: "shared", spaceIds: [] })
    yield* database.db.insert(Database.Schema.app_dependency).values({ app_id: app.id, dependency_app_id: base.id })
    yield* measure("link", profiles.link(root, acme.id, { appId: base.id, profileId: linked.id }))
    yield* measure("access remove", profiles.access(root, acme.id, { remove: [sales] }))
    yield* measure("all_spaces", profiles.access(root, acme.id, { allSpaces: true }))
    yield* measure(
      "create",
      ProfilesFixture.profile(root, { appId: app.id, slug: "globex", kind: "shared", spaceIds: [sales, extra] }),
    )
    const mine = yield* ProfilesFixture.profile(ana, { appId: app.id, slug: "ana", kind: "private" })
    yield* measure("promote", profiles.promote(ana, mine.id, {}), personal)
    yield* measure(
      "connect",
      credentials.create(root, {
        owner: { kind: "profile", profileId: acme.id },
        item: { env: "MAIL_KEY" },
        hosts: ["api.mail.example.com"],
        value: { type: "key", value: Redacted.make("mail-key") },
      }),
    )
    const credentialId = yield* ProfilesFixture.connect(organizationId, acme.id, "MCP_GMAIL__ACME")
    yield* measure("credential delete", credentials.remove(root, credentialId, {}))
    yield* ProfilesFixture.connect(organizationId, acme.id, "MCP_GMAIL__ACME", { holder: cy.userId })
    yield* measure("holder leaves the org", provisioning.archiveMemberships(organizationId, cy.userId))
    yield* measure("delete", profiles.delete(root, mine.id), personal)
    const current = yield* apps.get(root, app.id)
    yield* measure(
      "app edit",
      apps.update(root, app.id, {
        requiredCredentials: current.requiredCredentials,
        mcps: { gmail: ProfilesFixture.remote("Mail") },
        skills: {},
        dependsOn: ["base"],
        expectedRevision: current.revision,
      }),
    )
    yield* measure(
      "registry publish",
      registry.publish({
        apps: [
          Schema.decodeUnknownSync(AppRegistry.Publication)({
            slug: "docs",
            name: "Docs",
            description: "Docs",
            listing: {},
            skills: { guide: Seed.skill("Guide") },
          }),
        ],
      }),
    )
    yield* ProfilesFixture.profile(root, { appId: docs.id, slug: "extra", kind: "shared", spaceIds: [extra] })
    yield* measure("space archive", spaces.archive(root, extra), personal)
    yield* measure("member joins", members.create(root, { spaceId: ana.personal, userId: bob.userId }), personal)
    yield* measure("app archive", apps.archive(root, app.id))
    expect(steps).toEqual([
      { step: "access add", changed: true, cleared: true },
      { step: "rename", changed: true, cleared: true },
      { step: "link", changed: true, cleared: true },
      { step: "access remove", changed: true, cleared: true },
      { step: "all_spaces", changed: true, cleared: true },
      { step: "create", changed: true, cleared: true },
      { step: "promote", changed: true, cleared: true },
      { step: "connect", changed: true, cleared: true },
      { step: "credential delete", changed: true, cleared: true },
      { step: "holder leaves the org", changed: true, cleared: true },
      { step: "delete", changed: true, cleared: true },
      { step: "app edit", changed: true, cleared: false },
      { step: "registry publish", changed: true, cleared: false },
      { step: "space archive", changed: true, cleared: true },
      { step: "member joins", changed: true, cleared: true },
      { step: "app archive", changed: true, cleared: false },
    ])
    expect(
      (yield* database.db.select().from(Database.Schema.app).where(eq(Database.Schema.app.id, app.id))).at(0)?.revision,
    ).toBe(current.revision + 1)
  }),
)

it.live("a registry publish that clashes leaves out the newer app's part and reports it on its profiles (P25)", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const registry = yield* AppRegistry.Service
    const profiles = yield* AppProfiles.Service
    const organizationId = yield* Seed.organization()
    const root = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const kit = yield* ProfilesFixture.app(root, root.personal, "mail-kit", {
      mcps: { gmail: ProfilesFixture.remote("Gmail", { type: "none" }) },
    })
    const publication = (fields: Record<string, unknown>) =>
      Schema.decodeUnknownSync(AppRegistry.Publication)({
        slug: "inbox",
        name: "Inbox",
        description: "Inbox",
        listing: {},
        ...fields,
      })
    yield* registry.publish({
      apps: [publication({ mcps: { other: ProfilesFixture.remote("Other", { type: "none" }) } })],
    })
    const inbox = yield* apps.get(root, "inbox")
    const profile = yield* ProfilesFixture.profile(root, {
      appId: inbox.id,
      slug: "all",
      kind: "shared",
      allSpaces: true,
    })
    yield* registry.publish({
      apps: [
        publication({
          mcps: {
            other: ProfilesFixture.remote("Other", { type: "none" }),
            gmail: ProfilesFixture.remote("Gmail", { type: "none" }),
          },
        }),
      ],
    })
    const found = yield* ProfilesFixture.catalog(organizationId, root.personal)
    expect(found.catalog.mcps.map((entry) => `${entry.appSlug}/${entry.server}`)).toEqual([
      "inbox/other",
      "mail-kit/gmail",
    ])
    expect((yield* profiles.get(root, profile.id)).skipped).toEqual([{ kind: "mcps", slug: "gmail", also: "mail-kit" }])
    expect(kit.id).toBeDefined()
  }),
)

it.live("a provider without a layer, and a brain without the egress, leave the entry out and list it unavailable", () =>
  Effect.gen(function* () {
    const organizationId = yield* Seed.organization()
    const ana = yield* ProfilesFixture.user(organizationId, "Ana", "admin")
    const app = yield* ProfilesFixture.app(ana, ana.personal, "google", {
      mcps: {
        gmail: {
          name: "Gmail",
          description: "Gmail through a provider",
          transport: { type: "provider", provider: "pipedream", integration: "gmail" },
          auth: { type: "oauth", tokenEndpointAuth: "none" },
          requiredCredentials: [],
        },
        drive: ProfilesFixture.remote("Drive"),
      },
    })
    yield* owned(ana, app.id)
    const acme = yield* ProfilesFixture.profile(ana, {
      appId: app.id,
      slug: "acme",
      kind: "shared",
      allSpaces: true,
      name: "Acme client",
    })
    yield* ProfilesFixture.connect(organizationId, acme.id, "MCP_GMAIL__ACME")
    yield* ProfilesFixture.connect(organizationId, acme.id, "MCP_DRIVE__ACME")
    const found = yield* ProfilesFixture.catalog(organizationId, ana.personal)
    expect(found.catalog.mcps.map((entry) => entry.server)).toEqual(["drive__acme"])
    expect(found.catalog.unavailable).toEqual([
      { appSlug: "google", mcp: "gmail", profile: "Acme client", reason: "provider" },
    ])
    const outside = yield* ProfilesFixture.catalog(organizationId, ana.personal, { egress: false })
    expect(outside.catalog.mcps).toEqual([])
    expect(outside.catalog.unavailable.map((entry) => `${entry.mcp}:${entry.reason}`)).toEqual([
      "drive:egress",
      "gmail:provider",
    ])
  }),
)
