import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Mcp } from "@ren/schema/mcp"
import { Effect, Result, Schema } from "effect"
import { App } from "../src/app.js"
import { AppRegistry } from "../src/app/registry.js"
import { testEffect } from "./lib/effect.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(ProfilesFixture.layer)

const remote = (url: string) =>
  Schema.decodeUnknownSync(Mcp.Declaration)({
    name: "Search",
    description: "Search the web",
    transport: { type: "remote", url },
    auth: { type: "none" },
  })

const publication = (slug: string, fields: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(AppRegistry.Publication)({
    slug,
    name: slug,
    description: `The ${slug} app`,
    mcps: { [slug]: remote(`https://${slug}.example.com/mcp`) },
    listing: {},
    ...fields,
  })

const publish = Effect.fnUntraced(function* (input: AppRegistry.Publication) {
  const registry = yield* AppRegistry.Service
  const result = (yield* registry.publish({ apps: [input] })).apps.at(0)
  if (!result) return yield* Effect.die(new Error("Publication returned no app"))
  return result
})

const page = { page: 1, pageSize: 50 }

it.live("only execution changes raise the revision; every org that reaches the app gets the new definition", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const skill = { type: "upstream", upstream: { url: "https://github.com/renai-labs/Integrations", path: "a" } }
    const first = publication("docs", { skills: { guide: skill }, listing: { body: "Read docs" } })
    const created = yield* publish(first)
    expect(created).toMatchObject({ revision: 1, changed: { execution: true, metadata: true, listing: true } })
    expect(yield* publish(first)).toEqual({
      ...created,
      changed: { execution: false, metadata: false, listing: false },
    })
    const renamed = { ...first, name: "Docs", icon: "https://example.com/docs.png" }
    expect(yield* publish(renamed)).toMatchObject({ revision: 1, changed: { execution: false, metadata: true } })
    const relabeled = {
      ...renamed,
      listing: { body: "New", categories: { roles: ["engineer"] }, examplePrompts: ["Hi"] },
    }
    expect((yield* publish(relabeled)).changed).toEqual({ execution: false, metadata: false, listing: true })
    const next = yield* publish(
      publication("docs", {
        ...relabeled,
        skills: { guide: { ...skill, upstream: { ...skill.upstream, path: "b" } } },
      }),
    )
    expect(next).toMatchObject({ revision: 2, changed: { execution: true, metadata: false, listing: false } })
    const reader = yield* Seed.actor(yield* Seed.organization(), "member")
    expect(yield* registry.get(reader, "docs")).toMatchObject({
      name: "Docs",
      listing: { body: "New", categories: { roles: ["engineer"] }, examplePrompts: ["Hi"] },
      revision: 2,
      skills: { guide: { upstream: { path: "b" } } },
    })
  }),
)

it.live("publish refuses a slug that a custom app holds, and never writes onto it (P37)", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const registry = yield* AppRegistry.Service
    const organizationId = yield* Seed.organization()
    const owner = yield* ProfilesFixture.user(organizationId, "Ana", "admin")
    const app = yield* ProfilesFixture.app(owner, owner.personal, "owned")
    const refused = yield* Effect.flip(
      publish(publication("owned", { mcps: { owned: remote("https://ren.example.com/mcp") } })),
    )
    expect(refused).toMatchObject({ _tag: "Primitive.Conflict" })
    expect(refused.message).toContain("organization’s app")
    expect(yield* apps.get(owner, app.id)).toMatchObject({ revision: 1, mcps: {} })
    const foreign = yield* Seed.actor(yield* Seed.organization(), "admin")
    expect((yield* Effect.flip(registry.get(foreign, "owned")))._tag).toBe("Primitive.NotFound")
  }),
)

it.live("an admin reads a listed app but never edits, archives or moves it", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const listed = yield* publish(publication("listed"))
    const admin = yield* ProfilesFixture.user(yield* Seed.organization(), "Root", "admin")
    const app = yield* apps.get(admin, listed.appId)
    const edit = {
      name: "Mine",
      requiredCredentials: app.requiredCredentials,
      mcps: app.mcps,
      skills: app.skills,
      dependsOn: app.dependsOn,
      expectedRevision: app.revision,
    }
    expect((yield* Effect.flip(apps.update(admin, app.id, edit)))._tag).toBe("Primitive.Forbidden")
    expect((yield* Effect.flip(apps.archive(admin, app.id)))._tag).toBe("Primitive.Forbidden")
    expect((yield* Effect.flip(apps.transferOwnership(admin, app.id, { spaceId: admin.personal })))._tag).toBe(
      "Primitive.Forbidden",
    )
  }),
)

it.live("browsing lists active listings by text and category", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const reader = yield* Seed.actor(yield* Seed.organization(), "member")
    yield* registry.publish({
      apps: [
        publication("linear", { description: "Track issues", listing: { categories: { roles: ["engineer"] } } }),
        publication("notion", { description: "Write pages", listing: { categories: { roles: ["writer"] } } }),
        Schema.decodeUnknownSync(AppRegistry.Publication)({
          slug: "unlisted",
          name: "Unlisted",
          description: "Not listed",
        }),
      ],
    })
    const slugs = (input: { readonly query?: string; readonly category?: string }) =>
      Effect.map(registry.list(reader, { ...page, ...input }), (result) => result.items.map((item) => item.slug))
    expect(yield* slugs({})).toEqual(["linear", "notion"])
    yield* publish(
      publication("guide", {
        skills: {
          write: { type: "content", description: "Write guides", instructions: "Long", files: { "a.md": "A" } },
        },
      }),
    )
    expect((yield* registry.get(reader, "guide")).skills).toEqual({
      write: { type: "content", description: "Write guides", requiredCredentials: [] },
    })
    expect(yield* slugs({ query: "ISSUES" })).toEqual(["linear"])
    expect(yield* slugs({ category: "writer" })).toEqual(["notion"])
    expect((yield* Effect.flip(registry.get(reader, "unlisted")))._tag).toBe("Primitive.NotFound")
  }),
)

it.live("publications racing from one expected revision give one edit", () =>
  Effect.gen(function* () {
    const initial = yield* publish(publication("race"))
    const successors = ["https://one.example.com/mcp", "https://two.example.com/mcp"].map((url) =>
      publication("race", { mcps: { race: remote(url) }, expectedRevision: initial.revision }),
    )
    const results = yield* Effect.forEach(successors, (input) => Effect.result(publish(input)), {
      concurrency: "unbounded",
    })
    expect(results.filter(Result.isSuccess).map((result) => result.success.revision)).toEqual([2])
    expect(results.filter(Result.isFailure).map((result) => result.failure._tag)).toEqual(["Primitive.Conflict"])
  }),
)

it.live("a broken dependency rolls back the whole batch", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const database = yield* Database.Service
    const before = yield* publish(publication("search", { mcps: {} }))
    const missing = yield* Effect.flip(
      registry.publish({
        apps: [
          publication("search", { listing: { body: "Changed" } }),
          publication("orphan", { dependsOn: ["ghost"] }),
        ],
      }),
    )
    expect(missing.message).toContain("ghost")
    const rows = yield* database.db.select().from(Database.Schema.app)
    expect(rows.map((row) => [row.slug, row.revision])).toEqual([["search", before.revision]])
    expect(
      yield* database.db.select({ body: Database.Schema.app_listing.body }).from(Database.Schema.app_listing),
    ).toEqual([{ body: null }])
  }),
)

it.live("withdrawal is refused while another listed app depends on the app", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    yield* registry.publish({ apps: [publication("base"), publication("child", { dependsOn: ["base"] })] })
    const refused = yield* Effect.flip(registry.withdraw("base"))
    expect(refused._tag).toBe("Primitive.Conflict")
    expect(refused.message).toContain("child")
    yield* registry.withdraw("child")
    expect((yield* registry.withdraw("base")).archivedAt).not.toBeNull()
  }),
)

it.live("duplicate dependencies reject the batch without changing existing apps", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const database = yield* Database.Service
    const before = yield* publish(publication("base"))
    const failure = yield* registry
      .publish({
        apps: [publication("base", { description: "Changed" }), publication("child", { dependsOn: ["base", "base"] })],
      })
      .pipe(Effect.flip)
    expect(failure._tag).toBe("Primitive.Conflict")
    expect(failure.message).toContain("Duplicate dependency")
    expect(yield* database.db.select().from(Database.Schema.app)).toMatchObject([
      { id: before.appId, revision: 1, description: "The base app" },
    ])
    expect(yield* database.db.select().from(Database.Schema.app_dependency)).toEqual([])
  }),
)

it.live("publication rejects self-dependencies and cycles within a batch or through existing apps", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const database = yield* Database.Service
    yield* Effect.forEach(
      [
        [publication("self", { dependsOn: ["self"] })],
        [publication("first", { dependsOn: ["second"] }), publication("second", { dependsOn: ["first"] })],
      ],
      (apps) =>
        Effect.gen(function* () {
          const failure = yield* registry.publish({ apps }).pipe(Effect.flip)
          expect(failure._tag).toBe("Primitive.Conflict")
          expect(failure.message).toContain("Dependency cycle")
          expect(yield* database.db.select().from(Database.Schema.app)).toEqual([])
        }),
    )
    yield* registry.publish({ apps: [publication("first"), publication("second", { dependsOn: ["first"] })] })
    const failure = yield* publish(publication("first", { dependsOn: ["second"] })).pipe(Effect.flip)
    expect(failure._tag).toBe("Primitive.Conflict")
    expect(failure.message).toMatch(/first -> second -> first|second -> first -> second/u)
  }),
)

it.live("a withdrawn app keeps its profiles running and takes no new ones; publication does not relist", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const published = yield* publish(publication("withdrawn"))
    const organizationId = yield* Seed.organization()
    const consumer = yield* ProfilesFixture.user(organizationId, "Ana", "admin")
    yield* ProfilesFixture.profile(consumer, { appId: published.appId, slug: "all", kind: "shared", allSpaces: true })
    yield* registry.withdraw("withdrawn")
    expect((yield* Effect.flip(registry.get(consumer, "withdrawn")))._tag).toBe("Primitive.NotFound")
    expect(yield* ProfilesFixture.reach(organizationId, consumer.personal)).toEqual(["withdrawn/all"])
    const refused = yield* Effect.flip(
      ProfilesFixture.profile(consumer, { appId: published.appId, slug: "new", kind: "shared", spaceIds: [] }),
    )
    expect(refused._tag).toBe("Primitive.Conflict")
    yield* publish(publication("withdrawn", { mcps: { withdrawn: remote("https://next.example.com/mcp") } }))
    expect((yield* Effect.flip(registry.get(consumer, "withdrawn")))._tag).toBe("Primitive.NotFound")
    yield* registry.relist("withdrawn")
    expect((yield* registry.get(consumer, "withdrawn")).revision).toBe(2)
  }),
)
