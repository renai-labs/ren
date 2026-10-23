import { expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Exit, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppRelease } from "../src/app/release.js"
import { SpaceApp } from "../src/space/app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(App.layer, AppRelease.layer, SpaceApp.layer).pipe(
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

const setup = Effect.gen(function* () {
  const apps = yield* App.Service
  const releases = yield* AppRelease.Service
  const uses = yield* SpaceApp.Service
  const organizationId = yield* Seed.organization()
  const actor = yield* Seed.actor(organizationId, "admin")
  const owner = yield* Seed.space(organizationId)
  const input = Seed.appInput(owner, "notes")
  return { apps, releases, uses, organizationId, actor, input, app: yield* apps.create(actor, input) }
})

it.live("list endpoints hide inaccessible records but preserve database failures", () =>
  Effect.gen(function* () {
    const context = yield* setup
    const sql = yield* SqlClient.SqlClient
    const foreign = yield* Seed.actor(yield* Seed.organization(), "admin")
    expect((yield* context.releases.list(foreign, { appId: context.app.id, page: 1, pageSize: 50 })).items).toEqual([])
    expect(
      (yield* context.uses.list(foreign, { spaceId: context.input.ownerSpaceId, page: 1, pageSize: 50 })).items,
    ).toEqual([])
    const releases = yield* Effect.acquireUseRelease(
      sql`alter table app rename to unavailable_app`,
      () => Effect.exit(context.releases.list(context.actor, { appId: context.app.id, page: 1, pageSize: 50 })),
      () => sql`alter table unavailable_app rename to app`.pipe(Effect.orDie),
    )
    expect(Exit.isFailure(releases)).toBe(true)
    expect(String(releases)).not.toContain("COMMIT rolled back")
    const uses = yield* Effect.acquireUseRelease(
      sql`alter table space rename to unavailable_space`,
      () =>
        Effect.exit(context.uses.list(context.actor, { spaceId: context.input.ownerSpaceId, page: 1, pageSize: 50 })),
      () => sql`alter table unavailable_space rename to space`.pipe(Effect.orDie),
    )
    expect(Exit.isFailure(uses)).toBe(true)
    expect(String(uses)).not.toContain("COMMIT rolled back")
  }),
)

it.live("floating uses advance while pins retain execution and current metadata", () =>
  Effect.gen(function* () {
    const context = yield* setup
    const floating = yield* context.uses.create(context.actor, {
      spaceId: yield* Seed.space(context.organizationId),
      appId: context.app.id,
    })
    const pinned = yield* context.uses.create(context.actor, {
      spaceId: yield* Seed.space(context.organizationId),
      appId: context.app.id,
      pinnedReleaseId: context.app.latestReleaseId,
    })
    const next = yield* context.releases.create(context.actor, {
      ...context.input,
      appId: context.app.id,
      expectedLatestReleaseId: context.app.latestReleaseId,
      environment: { packages: {}, buildCommands: ["build"] },
    })
    expect(floating.release.version).toBe("0.0.1")
    expect(next.version).toBe("0.0.2")
    expect((yield* context.uses.get(context.actor, floating.id)).release.id).toBe(next.id)
    yield* context.apps.update(context.actor, context.app.id, { name: "Current name" })
    expect(yield* context.uses.get(context.actor, pinned.id)).toMatchObject({
      app: { name: "Current name" },
      release: { id: context.app.latestReleaseId },
    })
    expect((yield* context.uses.update(context.actor, pinned.id, { pinnedReleaseId: null })).release.id).toBe(next.id)
  }),
)

it.live("a repeated install preserves its existing pin", () =>
  Effect.gen(function* () {
    const context = yield* setup
    const spaceId = yield* Seed.space(context.organizationId)
    const pinned = yield* context.uses.create(context.actor, {
      spaceId,
      appId: context.app.id,
      pinnedReleaseId: context.app.latestReleaseId,
    })
    yield* context.releases.create(context.actor, {
      ...context.input,
      appId: context.app.id,
      expectedLatestReleaseId: context.app.latestReleaseId,
      environment: { packages: {}, buildCommands: ["build"] },
    })
    expect(yield* context.uses.create(context.actor, { spaceId, appId: context.app.id })).toMatchObject({
      id: pinned.id,
      pinnedReleaseId: pinned.pinnedReleaseId,
      release: pinned.release,
    })
  }),
)

it.live("same-app release constraints reject cross-app latest pointers and pins", () =>
  Effect.gen(function* () {
    const context = yield* setup
    const pinned = yield* context.uses.create(context.actor, {
      spaceId: yield* Seed.space(context.organizationId),
      appId: context.app.id,
    })
    const other = yield* context.apps.create(context.actor, { ...context.input, slug: "other" })
    const sql = yield* SqlClient.SqlClient
    const wrongLatest = yield* Effect.flip(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`set constraints all immediate`
          yield* sql`update app set latest_release_id = ${other.latestReleaseId} where id = ${context.app.id}`
        }),
      ),
    )
    expect(wrongLatest.reason._tag).toBe("ConstraintError")
    const wrongPin = yield* Effect.flip(
      sql.withTransaction(
        sql`update space_app set pinned_release_id = ${other.latestReleaseId} where id = ${pinned.id}`,
      ),
    )
    expect(wrongPin.reason._tag).toBe("ConstraintError")
    expect(
      (yield* Effect.flip(context.uses.update(context.actor, pinned.id, { pinnedReleaseId: other.latestReleaseId })))
        ._tag,
    ).toBe("Primitive.Conflict")
    expect((yield* context.apps.get(context.actor, context.app.id)).latestReleaseId).toBe(context.app.latestReleaseId)
  }),
)

it.live("unchanged configuration and identical retries retain release identity", () =>
  Effect.gen(function* () {
    const context = yield* setup
    expect(
      (yield* context.releases.create(context.actor, {
        ...context.input,
        appId: context.app.id,
        expectedLatestReleaseId: context.app.latestReleaseId,
      })).id,
    ).toBe(context.app.latestReleaseId)
    const input = {
      ...context.input,
      appId: context.app.id,
      expectedLatestReleaseId: context.app.latestReleaseId,
      version: "1.9.0",
      environment: { packages: { npm: ["library@1"] }, buildCommands: [] },
    }
    const release = yield* context.releases.create(context.actor, input)
    expect((yield* context.releases.create(context.actor, input)).id).toBe(release.id)
    expect((yield* context.releases.list(context.actor, { appId: context.app.id, page: 1, pageSize: 50 })).total).toBe(
      2,
    )
  }),
)

it.live("numeric successors reject equal, lower and stale conflicting versions without rewriting history", () =>
  Effect.gen(function* () {
    const context = yield* setup
    const first = {
      ...context.input,
      appId: context.app.id,
      expectedLatestReleaseId: context.app.latestReleaseId,
      version: "1.9.0",
      environment: { packages: { npm: ["library@1"] }, buildCommands: [] },
    }
    const nine = yield* context.releases.create(context.actor, first)
    const next = {
      ...first,
      version: "1.10.0",
      expectedLatestReleaseId: nine.id,
      environment: { packages: { npm: ["library@2"] }, buildCommands: [] },
    }
    const ten = yield* context.releases.create(context.actor, next)
    expect(ten.version).toBe("1.10.0")
    yield* Effect.forEach(
      ["1.9.0", "1.10.0", "1.8.0"],
      Effect.fnUntraced(function* (version) {
        expect(
          (yield* Effect.flip(
            context.releases.create(context.actor, {
              ...next,
              version,
              expectedLatestReleaseId: ten.id,
              environment: { packages: { npm: ["library@3"] }, buildCommands: [] },
            }),
          ))._tag,
        ).toBe("Primitive.Conflict")
      }),
    )
    expect(
      (yield* Effect.flip(
        context.releases.create(context.actor, { ...first, version: "2.0.0", expectedLatestReleaseId: nine.id }),
      )).message,
    ).toContain("changed")
    expect((yield* context.releases.list(context.actor, { appId: context.app.id, page: 1, pageSize: 50 })).total).toBe(
      3,
    )
  }),
)

it.live("a default patch promotes a prerelease to its stable version", () =>
  Effect.gen(function* () {
    const context = yield* setup
    const preview = yield* context.releases.create(context.actor, {
      ...context.input,
      appId: context.app.id,
      version: "2.0.0-beta.2",
      expectedLatestReleaseId: context.app.latestReleaseId,
      environment: { packages: {}, buildCommands: ["preview"] },
    })
    const stable = yield* context.releases.create(context.actor, {
      ...context.input,
      appId: context.app.id,
      expectedLatestReleaseId: preview.id,
      environment: { packages: {}, buildCommands: ["stable"] },
    })
    expect(stable.version).toBe("2.0.0")
  }),
)
