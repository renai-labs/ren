import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Mcp } from "@ren/schema/mcp"
import { eq } from "drizzle-orm"
import { Effect, Layer, Result, Schema } from "effect"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppRegistry } from "../src/app/registry.js"
import { SpaceApp } from "../src/space/app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(App.layer, AppRegistry.layer, SpaceApp.layer).pipe(
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

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

it.live("only execution changes cut releases; floating uses follow them and pins keep theirs", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const uses = yield* SpaceApp.Service
    const skill = { type: "upstream", upstream: { url: "https://github.com/renai-labs/Integrations", path: "a" } }
    const first = publication("docs", { skills: { guide: skill }, listing: { body: "Read docs" } })
    const created = yield* publish(first)
    expect(created).toMatchObject({ version: "1.0.0", changed: { execution: true, metadata: true, listing: true } })
    expect(yield* publish(first)).toEqual({
      ...created,
      changed: { execution: false, metadata: false, listing: false },
    })
    const consumer = yield* Seed.actor(yield* Seed.organization(), "admin")
    const floating = yield* uses.create(consumer, {
      spaceId: yield* Seed.space(consumer.organizationId),
      appId: created.appId,
    })
    const pinned = yield* uses.create(consumer, {
      spaceId: yield* Seed.space(consumer.organizationId),
      appId: created.appId,
      pinnedReleaseId: created.releaseId,
    })
    const renamed = { ...first, name: "Docs", icon: "https://example.com/docs.png" }
    expect((yield* publish(renamed)).changed).toEqual({ execution: false, metadata: true, listing: false })
    const relabeled = {
      ...renamed,
      listing: { body: "New", categories: { roles: ["engineer"] }, examplePrompts: ["Hi"] },
    }
    expect((yield* publish(relabeled)).changed).toEqual({ execution: false, metadata: false, listing: true })
    const successor = yield* publish(
      publication("docs", {
        ...relabeled,
        skills: { guide: { ...skill, upstream: { ...skill.upstream, path: "b" } } },
      }),
    )
    expect(successor).toMatchObject({ version: "1.0.1", changed: { execution: true, metadata: false, listing: false } })
    expect((yield* uses.get(consumer, floating.id)).release.id).toBe(successor.releaseId)
    expect(yield* uses.get(consumer, pinned.id)).toMatchObject({
      app: { name: "Docs", icon: "https://example.com/docs.png" },
      release: { id: created.releaseId, skills: { guide: { upstream: { path: "a" } } } },
    })
    expect(yield* registry.get(consumer, "docs")).toMatchObject({
      name: "Docs",
      listing: { body: "New", categories: { roles: ["engineer"] }, examplePrompts: ["Hi"] },
      release: { version: "1.0.1" },
    })
  }),
)

it.live("listing an organization's app keeps its owner and lets other organizations read and install it only", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const registry = yield* AppRegistry.Service
    const uses = yield* SpaceApp.Service
    const organizationId = yield* Seed.organization()
    const owner = yield* Seed.actor(organizationId, "admin")
    const ownerSpaceId = yield* Seed.space(organizationId)
    const app = yield* apps.create(owner, Seed.appInput(ownerSpaceId, "owned"))
    const foreign = yield* Seed.actor(yield* Seed.organization(), "admin")
    expect((yield* Effect.flip(registry.get(foreign, "owned")))._tag).toBe("Primitive.NotFound")
    const unnamed = yield* Effect.flip(
      publish(publication("owned", { mcps: { owned: remote("https://ren.example.com/mcp") } })),
    )
    expect(unnamed).toMatchObject({ _tag: "Primitive.Conflict" })
    expect(unnamed.message).toContain("organization")
    const misnamed = yield* Effect.flip(
      publish(publication("owned", { mcps: {}, organizationId: foreign.organizationId })),
    )
    expect(misnamed._tag).toBe("Primitive.Conflict")
    const absent = yield* Effect.flip(publish(publication("unowned", { organizationId })))
    expect(absent._tag).toBe("Primitive.Conflict")
    expect((yield* Effect.flip(registry.get(foreign, "owned")))._tag).toBe("Primitive.NotFound")
    expect((yield* apps.get(owner, app.id)).latestReleaseId).toBe(app.latestReleaseId)
    expect(yield* publish(publication("owned", { mcps: {}, organizationId }))).toMatchObject({
      appId: app.id,
      releaseId: app.latestReleaseId,
      changed: { execution: false, listing: true },
    })
    expect(yield* apps.get(foreign, app.id)).toMatchObject({ organizationId, ownerSpaceId })
    expect((yield* Effect.flip(apps.update(foreign, app.id, { name: "Stolen" })))._tag).toBe("Primitive.Forbidden")
    const installed = yield* uses.create(foreign, {
      spaceId: yield* Seed.space(foreign.organizationId),
      appId: app.id,
    })
    expect(installed).toMatchObject({ isOwner: false, pinnedReleaseId: null, release: { id: app.latestReleaseId } })
    yield* uses.create(owner, { spaceId: yield* Seed.space(organizationId), appId: app.id })
    const inUse = yield* Effect.flip(apps.archive(owner, app.id))
    expect(inUse._tag).toBe("Primitive.Conflict")
    expect(inUse.message).toContain("Team")
    expect(inUse.message).toContain("1 space of another organization")
    expect(inUse.message).not.toContain(installed.spaceId)
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
    expect(yield* slugs({ query: "ISSUES" })).toEqual(["linear"])
    expect(yield* slugs({ category: "writer" })).toEqual(["notion"])
    expect((yield* Effect.flip(registry.get(reader, "unlisted")))._tag).toBe("Primitive.NotFound")
  }),
)

it.live("publications racing from one expected release give one successor and never downgrade", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const database = yield* Database.Service
    const initial = yield* publish(publication("race"))
    const successors = ["https://one.example.com/mcp", "https://two.example.com/mcp"].map((url) =>
      publication("race", { mcps: { race: remote(url) }, expectedCurrentReleaseId: initial.releaseId }),
    )
    const results = yield* Effect.forEach(successors, (input) => Effect.result(publish(input)), {
      concurrency: "unbounded",
    })
    expect(results.filter(Result.isSuccess).map((result) => result.success.version)).toEqual(["1.0.1"])
    expect(results.filter(Result.isFailure).map((result) => result.failure._tag)).toEqual(["Primitive.Conflict"])
    const winner = successors.at(results.findIndex(Result.isSuccess))
    if (winner) expect((yield* publish(winner)).changed.execution).toBe(false)
    const lower = yield* Effect.flip(
      registry.publish({
        apps: [publication("race", { version: "1.0.0", mcps: { race: remote("https://three.example.com/mcp") } })],
      }),
    )
    expect(lower._tag).toBe("Primitive.Conflict")
    expect(
      (yield* database.db.select().from(Database.Schema.app_release)).map((row) => row.version).toSorted(),
    ).toEqual(["1.0.0", "1.0.1"])
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
    expect(rows.map((row) => [row.slug, row.latest_release_id])).toEqual([["search", before.releaseId]])
    expect(
      yield* database.db.select({ body: Database.Schema.app_listing.body }).from(Database.Schema.app_listing),
    ).toEqual([{ body: null }])
  }),
)

it.live(
  "a successor that would break a floating consumer space is refused with the checks of an organization write",
  () =>
    Effect.gen(function* () {
      const apps = yield* App.Service
      const uses = yield* SpaceApp.Service
      const database = yield* Database.Service
      const docs = yield* publish(publication("docs"))
      yield* publish(publication("base"))
      const consumer = yield* Seed.actor(yield* Seed.organization(), "admin")
      const spaceId = yield* Seed.space(consumer.organizationId)
      yield* uses.create(consumer, { spaceId, appId: docs.appId })
      yield* apps.create(
        consumer,
        Seed.appInput(spaceId, "local", {
          skills: {
            guide: { type: "content", description: "Guide", instructions: "Ours", files: {}, requiredCredentials: [] },
          },
        }),
      )
      const clash = yield* Effect.flip(
        publish(
          publication("docs", {
            skills: {
              guide: {
                type: "content",
                description: "Guide",
                instructions: "Theirs",
                files: {},
                requiredCredentials: [],
              },
            },
          }),
        ),
      )
      expect(clash._tag).toBe("Primitive.Conflict")
      expect(clash.message).toContain("Component collision")
      const missing = yield* Effect.flip(publish(publication("docs", { dependsOn: ["base"] })))
      expect(missing._tag).toBe("Primitive.Conflict")
      expect(missing.message).toContain("Missing dependency")
      expect(
        (yield* database.db
          .select()
          .from(Database.Schema.app_release)
          .where(eq(Database.Schema.app_release.app_id, docs.appId))).map((row) => row.id),
      ).toEqual([docs.releaseId])
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

it.live("duplicate dependencies reject the batch without changing existing releases", () =>
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
    expect(failure.message).toContain("child")
    expect(failure.message).toContain("base")
    expect(yield* database.db.select().from(Database.Schema.app)).toMatchObject([
      { id: before.appId, latest_release_id: before.releaseId, description: "The base app" },
    ])
    expect(yield* database.db.select().from(Database.Schema.app_release_dependency)).toEqual([])
  }),
)

it.live("publication rejects self-dependencies and cycles within a batch or through existing releases", () =>
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
    const initial = yield* registry.publish({
      apps: [publication("first"), publication("second", { dependsOn: ["first"] })],
    })
    const failure = yield* publish(publication("first", { dependsOn: ["second"] })).pipe(Effect.flip)
    expect(failure._tag).toBe("Primitive.Conflict")
    expect(failure.message).toMatch(/first -> second -> first|second -> first -> second/u)
    expect((yield* database.db.select().from(Database.Schema.app_release)).map((row) => row.id).toSorted()).toEqual(
      initial.apps.map((app) => app.releaseId).toSorted(),
    )
  }),
)

it.live("withdrawal keeps installations, latest selection and pins; publication does not relist", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const uses = yield* SpaceApp.Service
    const published = yield* publish(publication("withdrawn"))
    const consumer = yield* Seed.actor(yield* Seed.organization(), "admin")
    const floating = yield* uses.create(consumer, {
      spaceId: yield* Seed.space(consumer.organizationId),
      appId: published.appId,
    })
    yield* registry.withdraw("withdrawn")
    expect((yield* Effect.flip(registry.get(consumer, "withdrawn")))._tag).toBe("Primitive.NotFound")
    const stranger = yield* Seed.actor(yield* Seed.organization(), "admin")
    const refused = yield* Effect.flip(
      uses.create(stranger, { spaceId: yield* Seed.space(stranger.organizationId), appId: published.appId }),
    )
    expect(refused._tag).toBe("Primitive.NotFound")
    const successor = yield* publish(
      publication("withdrawn", { mcps: { withdrawn: remote("https://next.example.com/mcp") } }),
    )
    expect((yield* uses.get(consumer, floating.id)).release.id).toBe(successor.releaseId)
    expect((yield* Effect.flip(registry.get(consumer, "withdrawn")))._tag).toBe("Primitive.NotFound")
    yield* registry.relist("withdrawn")
    expect((yield* registry.get(stranger, "withdrawn")).release.id).toBe(successor.releaseId)
  }),
)
