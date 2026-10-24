import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppRelease } from "../src/app/release.js"
import { AppResolve } from "../src/app/resolve.js"
import { SpaceApp } from "../src/space/app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(App.layer, AppRelease.layer, SpaceApp.layer, AppResolve.layer).pipe(
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

it.live("invalid unrelated consumer graphs cannot block a write or a catalog read", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const uses = yield* SpaceApp.Service
    const resolver = yield* AppResolve.Service
    const sql = yield* SqlClient.SqlClient
    const brokenOrg = yield* Seed.organization()
    const brokenActor = yield* Seed.actor(brokenOrg, "admin")
    const brokenSpace = yield* Seed.space(brokenOrg)
    const base = yield* apps.create(brokenActor, Seed.appInput(brokenSpace, "broken-base"))
    yield* apps.create(brokenActor, Seed.appInput(brokenSpace, "broken-root", { dependsOn: [base.slug] }))
    yield* sql`update app set archived_at = now() where id = ${base.id}`
    const otherSpace = yield* Seed.space(brokenOrg)
    const independent = yield* apps.create(brokenActor, Seed.appInput(otherSpace, "independent"))
    expect((yield* resolver.forSpace(otherSpace)).catalog.apps.at(0)?.appId).toBe(independent.id)
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const consumer = yield* Seed.space(organizationId)
    const app = yield* apps.create(actor, Seed.appInput(owner, "isolated"))
    expect((yield* uses.create(actor, { spaceId: consumer, appId: app.id })).appId).toBe(app.id)
    expect((yield* resolver.forSpace(consumer)).catalog.apps.at(0)?.appId).toBe(app.id)
  }),
)

it.live("pip extras and normalized names cannot conceal incompatible requirements", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    yield* apps.create(
      actor,
      Seed.appInput(owner, "pip-one", {
        environment: { packages: { pip: ["My_Package[security]==1"] }, buildCommands: [] },
      }),
    )
    const error = yield* Effect.flip(
      apps.create(
        actor,
        Seed.appInput(owner, "pip-two", { environment: { packages: { pip: ["my-package==2"] }, buildCommands: [] } }),
      ),
    )
    expect(error.message).toContain("Package conflict")
    expect(error.message).toContain("pip/my-package")
  }),
)

it.live("dependencies install atomically, pins retain historical edges and invalid promotion/removal rolls back", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const releases = yield* AppRelease.Service
    const uses = yield* SpaceApp.Service
    const database = yield* Database.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const consumer = yield* Seed.space(organizationId)
    const base = yield* apps.create(actor, Seed.appInput(owner, "base"))
    const rootInput = Seed.appInput(owner, "root", { dependsOn: ["base"] })
    const root = yield* apps.create(actor, rootInput)
    const use = yield* uses.create(actor, { spaceId: consumer, appId: root.id })
    const list = yield* uses.list(actor, { spaceId: consumer, page: 1, pageSize: 50 })
    const dependency = list.items.find((entry) => entry.appId === base.id)
    if (!dependency) return yield* Effect.die(new Error("The dependency was not installed"))
    expect((yield* Effect.flip(uses.archive(actor, dependency.id))).message).toContain("root")
    const extra = yield* apps.create(actor, Seed.appInput(owner, "extra"))
    const proposed = {
      ...rootInput,
      appId: root.id,
      expectedLatestReleaseId: root.latestReleaseId,
      dependsOn: ["base", "extra"],
    }
    expect((yield* Effect.flip(releases.create(actor, proposed))).message).toContain(consumer)
    expect((yield* apps.get(actor, root.id)).latestReleaseId).toBe(root.latestReleaseId)
    expect((yield* releases.list(actor, { appId: root.id, page: 1, pageSize: 50 })).total).toBe(1)
    yield* uses.update(actor, use.id, { pinnedReleaseId: root.latestReleaseId })
    const next = yield* releases.create(actor, proposed)
    expect((yield* uses.get(actor, use.id)).release.dependsOn).toEqual(["base"])
    expect((yield* uses.update(actor, use.id, { pinnedReleaseId: null })).release.id).toBe(next.id)
    expect(
      (yield* uses.list(actor, { spaceId: consumer, page: 1, pageSize: 50 })).items.some(
        (entry) => entry.appId === extra.id,
      ),
    ).toBe(true)
    yield* uses.archive(actor, use.id)
    expect((yield* uses.list(actor, { spaceId: owner, page: 1, pageSize: 50 })).total).toBe(3)
    expect((yield* database.db.select().from(Database.Schema.app_release_dependency)).length).toBe(3)
    expect((yield* uses.get(actor, use.id)).archivedAt).not.toBeNull()
  }),
)

it.live("private dependency lookup, self-links, component ownership and package conflicts reject partial writes", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const releases = yield* AppRelease.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const input = Seed.appInput(owner, "root", {
      skills: {
        notes: { type: "content", description: "Notes", instructions: "Write", files: {}, requiredCredentials: [] },
      },
      environment: { packages: { npm: ["library@1"] }, buildCommands: [] },
    })
    const root = yield* apps.create(actor, input)
    expect(
      (yield* Effect.flip(apps.create(actor, Seed.appInput(owner, "missing", { dependsOn: ["absent"] }))))._tag,
    ).toBe("Primitive.NotFound")
    const self = yield* Effect.flip(
      releases.create(actor, {
        ...input,
        appId: root.id,
        expectedLatestReleaseId: root.latestReleaseId,
        dependsOn: ["root"],
      }),
    )
    expect(self.message).toContain("itself")
    const duplicate = yield* Effect.flip(apps.create(actor, { ...input, slug: "duplicate" }))
    expect(duplicate.message).toContain("Component collision")
    const packages = yield* Effect.flip(
      apps.create(
        actor,
        Seed.appInput(owner, "packages", { environment: { packages: { npm: ["library@2"] }, buildCommands: [] } }),
      ),
    )
    expect(packages.message).toContain("Package conflict")
    const other = yield* apps.create(actor, Seed.appInput(owner, "other", { dependsOn: ["root"] }))
    const cycle = yield* Effect.flip(
      releases.create(actor, {
        ...input,
        appId: root.id,
        expectedLatestReleaseId: root.latestReleaseId,
        dependsOn: [other.slug],
      }),
    )
    expect(cycle.message).toMatch(/root -> other -> root|other -> root -> other/u)
    expect((yield* apps.list(actor, { page: 1, pageSize: 50 })).total).toBe(2)
    expect((yield* Effect.flip(releases.get(actor, AppRelease.ID.create())))._tag).toBe("Primitive.NotFound")
  }),
)

it.live("ownership transfers validate the destination and optionally retain the old owner's use", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const uses = yield* SpaceApp.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const target = yield* Seed.space(organizationId)
    const base = yield* apps.create(actor, Seed.appInput(owner, "base"))
    const root = yield* apps.create(actor, Seed.appInput(owner, "root", { dependsOn: ["base"] }))
    const transfer = yield* Effect.flip(apps.transferOwnership(actor, root.id, { spaceId: target }))
    expect(transfer.message).toContain(target)
    yield* uses.create(actor, { spaceId: target, appId: base.id })
    yield* apps.transferOwnership(actor, root.id, { spaceId: target, retainUse: true })
    const old = (yield* uses.list(actor, { spaceId: owner, page: 1, pageSize: 50 })).items.find(
      (entry) => entry.appId === root.id,
    )
    expect(old?.isOwner).toBe(false)
    expect((yield* Effect.flip(apps.archive(actor, root.id))).message).toContain("still used in spaces Team")
    if (!old) return yield* Effect.die(new Error("The retained use is missing"))
    yield* uses.archive(actor, old.id)
    yield* apps.archive(actor, root.id)
    expect((yield* Effect.flip(apps.get(actor, root.id)))._tag).toBe("Primitive.NotFound")
    const reserved = yield* Effect.flip(apps.create(actor, Seed.appInput(owner, "root")))
    expect(reserved._tag).toBe("Primitive.Conflict")
  }),
)
