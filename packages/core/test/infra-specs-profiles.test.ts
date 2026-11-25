import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { AppIdentity } from "@ren/schema/app/identity"
import { AppProfile } from "@ren/schema/app-profile"
import type { Infra } from "@ren/schema/infra"
import { Effect, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Space } from "../src/space.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const unique = () => `notes-${crypto.randomUUID().slice(0, 8)}`

const notes = (slug: string) => ({
  [slug]: {
    name: "Notes",
    description: "Writes notes.",
    skills: { [`${slug}-write`]: { type: "content", description: "Takes notes.", instructions: "Write." } },
  },
})

const input = (
  organization: string,
  spaces: Record<string, unknown>,
  bound: Record<string, unknown> = {},
  profiles: Record<string, unknown> = {},
) => ({
  bindings: InfraFixture.bindings(organization, bound, profiles),
  spec: InfraFixture.spec(spaces),
})

const apply = Effect.fnUntraced(function* (actor: Actor.Info, planned: Infra.PlanInput) {
  const infra = yield* InfraSpecs.Service
  const input = yield* InfraFixture.current(actor, planned)
  const plan = yield* infra.plan(actor, input)
  expect(plan.problems).toEqual([])
  yield* infra.apply(actor, { ...input, digest: plan.digest })
  return { changes: InfraFixture.withoutValues(plan.changes) }
})

const setup = Effect.gen(function* () {
  const apps = yield* App.Service
  const profiles = yield* AppProfiles.Service
  const spaces = yield* Space.Service
  const o = yield* InfraFixture.org
  const eng = yield* spaces.create(o.admin, { name: "Eng", slug: "eng" })
  const slug = unique()
  const declared = { home: { name: "Home", apps: notes(slug) }, eng: { name: "Eng" } }
  yield* apply(o.admin, input(o.bindings.organization, declared))
  const team = yield* profiles.create(o.admin, {
    appId: (yield* apps.get(o.admin, slug)).id,
    name: "Team",
    slug: Schema.decodeUnknownSync(AppProfile.Slug)("team"),
    kind: "shared",
    spaceIds: [o.home.id],
  })
  return { o, eng, slug, declared, team }
})

const listed = Effect.fnUntraced(function* (actor: Actor.Info, id: AppProfile.ID) {
  const profiles = yield* AppProfiles.Service
  return (yield* profiles.get(actor, id)).spaces.map((space) => space.name).toSorted()
})

const found = Effect.fnUntraced(function* (actor: Actor.Info, app: string, slug: string) {
  const apps = yield* App.Service
  const profiles = yield* AppProfiles.Service
  const page = yield* profiles.list(actor, { appId: (yield* apps.get(actor, app)).id, page: 1, pageSize: 50 })
  const profile = page.items.find((item) => item.slug === slug)
  return (
    profile && {
      name: profile.name,
      allSpaces: profile.allSpaces,
      spaces: profile.spaces.map((space) => space.name).toSorted(),
    }
  )
})

describe("InfraSpecs profiles", () => {
  it.live("listing a profile adds the space, replans with no changes, and pull writes it back", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const wanted = input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: ["team"] } } })

      const plan = yield* apply(s.o.admin, wanted)

      expect(plan.changes).toEqual([
        InfraFixture.change("create", "profile", `deploy.yaml/spaces/eng/profiles/${s.slug}/team`),
      ])
      expect(yield* listed(s.o.admin, s.team.id)).toEqual(["Eng", "Home"])
      expect(yield* infra.plan(s.o.admin, wanted)).toMatchObject({ changes: [], problems: [] })

      const pulled = yield* infra.pull(s.o.admin, {})
      expect(pulled.bindings.spaces).toEqual({
        home: { channels: {}, profiles: { [s.slug]: ["home", "team"] } },
        eng: { channels: {}, profiles: { [s.slug]: ["team"] } },
      })
      expect(yield* infra.plan(s.o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("unlisting removes a space that another space keeps listed, and refuses to delete the profile", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      yield* apply(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: ["team"] } } }),
      )

      const removed = yield* apply(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: [] } } }),
      )

      expect(removed.changes).toEqual([
        InfraFixture.change("archive", "profile", `deploy.yaml/spaces/eng/profiles/${s.slug}/team`),
      ])
      expect(yield* listed(s.o.admin, s.team.id)).toEqual(["Home"])

      const last = yield* infra.plan(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { home: { profiles: { [s.slug]: ["home"] } } }),
      )

      expect(last).toMatchObject({
        changes: [],
        problems: [
          {
            path: `deploy.yaml/spaces/home/profiles/${s.slug}/team`,
            message: `No other space lists profile team of ${s.slug}, so removing it would delete the profile and its credentials. Infra never deletes a profile: keep it listed, or delete it in the app.`,
          },
        ],
      })
      const profiles = yield* AppProfiles.Service
      expect((yield* profiles.unlist(s.o.admin, s.team.id, [s.o.home.id]).pipe(Effect.flip))._tag).toBe(
        "Primitive.Conflict",
      )
      expect(yield* listed(s.o.admin, s.team.id)).toEqual(["Home"])
    }),
  )

  it.live("apply creates a declared profile on the spaces that list it and renames it, and pull writes it back", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const wanted = (name: string) =>
        input(
          s.o.bindings.organization,
          s.declared,
          { eng: { profiles: { [s.slug]: ["bot"] } } },
          { [s.slug]: { bot: { name } } },
        )

      const created = yield* apply(s.o.admin, wanted("Bot"))

      expect(created.changes).toEqual([InfraFixture.change("create", "profile", `deploy.yaml/profiles/${s.slug}/bot`)])
      expect(yield* found(s.o.admin, s.slug, "bot")).toEqual({ name: "Bot", allSpaces: false, spaces: ["Eng"] })
      expect(yield* infra.plan(s.o.admin, wanted("Bot"))).toMatchObject({ changes: [], problems: [] })

      const renamed = yield* apply(s.o.admin, wanted("Acme bot"))

      expect(renamed.changes).toEqual([
        InfraFixture.change("update", "profile", `deploy.yaml/profiles/${s.slug}/bot`, { fields: ["name"] }),
      ])
      expect(yield* found(s.o.admin, s.slug, "bot")).toEqual({ name: "Acme bot", allSpaces: false, spaces: ["Eng"] })
      const pulled = yield* infra.pull(s.o.admin, {})
      expect(pulled.bindings.profiles).toEqual({
        [s.slug]: { bot: { name: "Acme bot" }, home: { name: "Home" }, team: { name: "Team" } },
      })
      expect(yield* infra.plan(s.o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("apply shares a declared profile with every space, and turns that off and on without deleting it", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const wanted = (state: { readonly allSpaces: boolean; readonly listing: ReadonlyArray<string> }) =>
        input(
          s.o.bindings.organization,
          s.declared,
          { eng: { profiles: { [s.slug]: state.listing } } },
          { [s.slug]: { all: { name: "All", ...(state.allSpaces && { allSpaces: true }) } } },
        )
      const all = `deploy.yaml/profiles/${s.slug}/all`

      expect((yield* apply(s.o.admin, wanted({ allSpaces: true, listing: [] }))).changes).toEqual([
        InfraFixture.change("create", "profile", all),
      ])
      expect(yield* found(s.o.admin, s.slug, "all")).toEqual({ name: "All", allSpaces: true, spaces: [] })
      expect((yield* infra.plan(s.o.admin, wanted({ allSpaces: true, listing: ["all"] }))).problems).toEqual([
        {
          path: `deploy.yaml/spaces/eng/profiles/${s.slug}/all`,
          message: `Profile all of ${s.slug} is shared with every space. Remove it from deploy.yaml.`,
        },
      ])
      expect((yield* infra.plan(s.o.admin, wanted({ allSpaces: false, listing: [] }))).problems).toEqual([
        {
          path: all,
          message: `No space lists profile all of ${s.slug}, so turning off allSpaces would delete it and its credentials. List it on a space first.`,
        },
      ])

      expect((yield* apply(s.o.admin, wanted({ allSpaces: false, listing: ["all"] }))).changes).toEqual([
        InfraFixture.change("create", "profile", `deploy.yaml/spaces/eng/profiles/${s.slug}/all`),
        InfraFixture.change("update", "profile", all, { fields: ["allSpaces"] }),
      ])
      expect(yield* found(s.o.admin, s.slug, "all")).toEqual({ name: "All", allSpaces: false, spaces: ["Eng"] })

      expect((yield* apply(s.o.admin, wanted({ allSpaces: true, listing: [] }))).changes).toEqual([
        InfraFixture.change("update", "profile", all, { fields: ["allSpaces"] }),
      ])
      expect(yield* found(s.o.admin, s.slug, "all")).toMatchObject({ allSpaces: true })
      expect(yield* infra.plan(s.o.admin, wanted({ allSpaces: true, listing: [] }))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("a deploy.yaml and a lock from before the profile catalogue plan nothing, and pull adds the catalogue", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      yield* apply(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: ["team"] } } }),
      )
      const pulled = yield* InfraFixture.replan(yield* infra.pull(s.o.admin, {}))
      const before = {
        spec: pulled.spec,
        bindings: { ...pulled.bindings, profiles: {} },
        lock: {
          organization: s.o.bindings.organization,
          resources: Object.fromEntries(
            Object.entries(pulled.lock?.resources ?? {}).filter(
              (entry) => !entry[0].startsWith("deploy.yaml/profiles/"),
            ),
          ),
        },
      }

      expect(yield* infra.plan(s.o.admin, before)).toMatchObject({ changes: [], problems: [] })
      const again = yield* infra.pull(s.o.admin, before)
      expect(again.conflicts).toEqual([])
      expect(again.write).toEqual([`deploy.yaml/profiles/${s.slug}/home`, `deploy.yaml/profiles/${s.slug}/team`])
    }),
  )

  it.live("the profiles that Ren makes for a new app and its dependencies leave the plan empty", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const other = unique()
      const spaces = {
        home: {
          name: "Home",
          apps: { ...notes(s.slug), [other]: { name: "Other", description: "Uses notes.", dependsOn: [s.slug] } },
        },
        eng: { name: "Eng" },
      }
      const wanted = input(
        s.o.bindings.organization,
        spaces,
        { eng: { profiles: { [other]: ["bot"] } } },
        { [other]: { bot: { name: "Bot" } } },
      )

      yield* apply(s.o.admin, wanted)

      expect(yield* found(s.o.admin, other, "home")).toEqual({ name: "Home", allSpaces: false, spaces: ["Home"] })
      expect(yield* found(s.o.admin, s.slug, "bot")).toEqual({ name: "Bot", allSpaces: false, spaces: ["Eng"] })
      expect(yield* infra.plan(s.o.admin, wanted)).toMatchObject({ changes: [], problems: [] })
      expect(yield* infra.plan(s.o.admin, yield* InfraFixture.pulled(s.o.admin))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("a declared profile that Ren made for a dependency earlier in the same apply is taken over", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const first = `a${unique()}`
      const spaces = {
        home: {
          name: "Home",
          apps: { ...notes(s.slug), [first]: { name: "First", description: "Uses notes.", dependsOn: [s.slug] } },
        },
        eng: { name: "Eng" },
      }
      const wanted = input(
        s.o.bindings.organization,
        spaces,
        { eng: { profiles: { [first]: ["bot"], [s.slug]: ["bot"] } } },
        { [first]: { bot: { name: "Bot" } }, [s.slug]: { bot: { name: "Notes bot" } } },
      )

      expect((yield* apply(s.o.admin, wanted)).changes).toEqual([
        InfraFixture.change("create", "app", `spaces/home/apps/${first}`),
        InfraFixture.change("create", "profile", `deploy.yaml/profiles/${first}/bot`),
        InfraFixture.change("create", "profile", `deploy.yaml/profiles/${s.slug}/bot`),
      ])

      expect(yield* found(s.o.admin, s.slug, "bot")).toEqual({ name: "Notes bot", allSpaces: false, spaces: ["Eng"] })
      expect(yield* infra.plan(s.o.admin, wanted)).toMatchObject({ changes: [], problems: [] })
    }),
  )

  it.live("a rename made in Ren since the last pull plans as changed in Ren", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const profiles = yield* AppProfiles.Service
      const s = yield* setup
      const wanted = input(s.o.bindings.organization, s.declared, {}, { [s.slug]: { team: { name: "Team" } } })
      const lock = (yield* infra.pull(s.o.admin, {})).lock

      yield* profiles.update(s.o.admin, s.team.id, { name: "Renamed" })

      expect((yield* infra.plan(s.o.admin, { ...wanted, lock })).changes).toEqual([
        InfraFixture.change("update", "profile", `deploy.yaml/profiles/${s.slug}/team`, {
          fields: ["name"],
          status: "changed",
          values: [{ field: "name", ren: "Renamed", folder: "Team" }],
        }),
      ])
    }),
  )

  it.live("a profile that apply cannot make, rename or list is a problem", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const database = yield* Database.Service
      const apps = yield* App.Service
      const profiles = yield* AppProfiles.Service
      const s = yield* setup
      const fresh = unique()
      const missing = unique()
      const gone = unique()
      const spaces = { home: { name: "Home", apps: { ...notes(s.slug), ...notes(fresh) } }, eng: { name: "Eng" } }
      yield* profiles.create(s.o.admin, {
        appId: (yield* apps.get(s.o.admin, s.slug)).id,
        name: "Mine",
        slug: Schema.decodeUnknownSync(AppProfile.Slug)("mine"),
        kind: "private",
      })
      yield* database.db.insert(Database.Schema.app).values({
        id: AppIdentity.ID.create(),
        slug: gone,
        name: "Gone",
        description: "Withdrawn.",
        required_credentials: [],
        mcps: {},
        skills: {},
      })

      const plan = yield* infra.plan(
        s.o.admin,
        input(
          s.o.bindings.organization,
          spaces,
          {
            home: { profiles: { [fresh]: ["home"], [s.slug]: ["home", "team", "twin"] } },
            eng: { profiles: { [s.slug]: ["nope"] } },
          },
          {
            [s.slug]: { mine: { name: "Mine too" }, twin: { name: "team" } },
            [missing]: { bot: { name: "Bot" } },
            [gone]: { bot: { name: "Bot" } },
          },
        ),
      )

      expect(plan.problems).toEqual(
        [
          {
            path: `deploy.yaml/profiles/${gone}/bot`,
            message: `App ${gone} is withdrawn from the registry, so it takes no new profiles.`,
          },
          {
            path: `deploy.yaml/profiles/${missing}/bot`,
            message: `App ${missing} is not in this organization or the registry.`,
          },
          {
            path: `deploy.yaml/profiles/${s.slug}/mine`,
            message: `Profile mine of ${s.slug} is a private profile, and infra manages shared profiles only. Choose another slug.`,
          },
          {
            path: `deploy.yaml/profiles/${s.slug}/twin`,
            message: `Profile team of ${s.slug} is also named “Team” in space home. Choose another name.`,
          },
          {
            path: `deploy.yaml/spaces/eng/profiles/${s.slug}/nope`,
            message: `Declare the shared profile nope of ${s.slug} under profiles in deploy.yaml, or create it in Ren.`,
          },
          {
            path: `deploy.yaml/spaces/home/profiles/${fresh}/home`,
            message: `Declare the shared profile home of ${fresh} under profiles in deploy.yaml, or create it in Ren.`,
          },
        ].toSorted((left, right) => left.path.localeCompare(right.path)),
      )
    }),
  )
})
