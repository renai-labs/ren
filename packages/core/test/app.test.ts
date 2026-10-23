import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { EgressControl } from "../src/egress-control.js"
import { SpaceApp } from "../src/space/app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"

const it = testEffect(
  Layer.mergeAll(App.layer, SpaceApp.layer, Space.layer, SpaceMember.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

it.live("private read access follows using spaces while edits and transfers retain owner checks", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const uses = yield* SpaceApp.Service
    const spaces = yield* Space.Service
    const members = yield* SpaceMember.Service
    const organizationId = yield* Seed.organization()
    const owner = yield* Seed.actor(organizationId, "member")
    const consumer = yield* Seed.actor(organizationId, "member")
    const admin = yield* Seed.actor(organizationId, "admin")
    const source = yield* spaces.create(owner, { name: "Source" })
    const target = yield* spaces.create(consumer, { name: "Target" })
    const app = yield* apps.create(owner, Seed.appInput(source.id, "private"))
    expect((yield* Effect.flip(apps.get(consumer, app.id)))._tag).toBe("Primitive.NotFound")
    const inaccessible = yield* Effect.flip(
      apps.create(consumer, Seed.appInput(target.id, "blocked", { dependsOn: ["private"] })),
    )
    expect(inaccessible._tag).toBe("Primitive.NotFound")
    const installed = yield* uses.create(admin, { spaceId: target.id, appId: app.id })
    expect((yield* Effect.flip(uses.get(owner, installed.id)))._tag).toBe("Primitive.NotFound")
    expect((yield* Effect.flip(uses.get(consumer, SpaceApp.ofOwner(app.id))))._tag).toBe("Primitive.NotFound")
    expect((yield* apps.get(consumer, app.id)).id).toBe(app.id)
    expect((yield* Effect.flip(apps.update(consumer, app.id, { name: "Changed" })))._tag).toBe("Primitive.Forbidden")
    expect((yield* Effect.flip(apps.transferOwnership(consumer, app.id, { spaceId: target.id })))._tag).toBe(
      "Primitive.Forbidden",
    )
    yield* members.create(admin, { spaceId: target.id, userId: owner.userId })
    yield* apps.transferOwnership(owner, app.id, { spaceId: target.id })
    expect((yield* apps.update(consumer, app.id, { name: "Now owned" })).name).toBe("Now owned")
  }),
)

it.live("a consumer member can remove their last use of an app", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const uses = yield* SpaceApp.Service
    const spaces = yield* Space.Service
    const organizationId = yield* Seed.organization()
    const admin = yield* Seed.actor(organizationId, "admin")
    const consumer = yield* Seed.actor(organizationId, "member")
    const owner = yield* Seed.space(organizationId)
    const target = yield* spaces.create(consumer, { name: "Consumer" })
    const app = yield* apps.create(admin, Seed.appInput(owner, "removable"))
    const installed = yield* uses.create(admin, { spaceId: target.id, appId: app.id })
    expect((yield* uses.archive(consumer, installed.id)).archivedAt).not.toBeNull()
    expect((yield* uses.list(consumer, { spaceId: target.id, page: 1, pageSize: 50 })).total).toBe(0)
    expect((yield* apps.get(admin, app.id)).id).toBe(app.id)
    expect((yield* Effect.flip(apps.get(consumer, app.id)))._tag).toBe("Primitive.NotFound")
  }),
)

it.live("self-dependency during creation reports the authored slug", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const error = yield* Effect.flip(apps.create(actor, Seed.appInput(owner, "self", { dependsOn: ["self"] })))
    expect(error._tag).toBe("Primitive.Conflict")
    expect(error.message).toContain("cannot depend on itself")
  }),
)

it.live("a space cannot archive while it owns an app; archiving a consumer retires only that space's uses", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const uses = yield* SpaceApp.Service
    const spaces = yield* Space.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    yield* spaces.create(actor, { name: "First" })
    const owner = yield* spaces.create(actor, { name: "Owner" })
    const consumer = yield* spaces.create(actor, { name: "Consumer" })
    const app = yield* apps.create(actor, Seed.appInput(owner.id, "archive-space"))
    const error = yield* Effect.flip(spaces.archive(actor, owner.id))
    expect(error._tag).toBe("Primitive.Conflict")
    yield* uses.create(actor, { spaceId: consumer.id, appId: app.id })
    yield* spaces.archive(actor, consumer.id)
    yield* apps.archive(actor, app.id)
  }),
)

it.live("creates an initial release, derives owner use, shares privately and edits metadata without a release", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const uses = yield* SpaceApp.Service
    const database = yield* Database.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const ownerSpaceId = yield* Seed.space(organizationId)
    const target = yield* Seed.space(organizationId)
    const input = Schema.decodeUnknownSync(App.CreateInput)({
      slug: "notes",
      ownerSpaceId,
      name: "Notes",
      description: "Write notes",
    })
    const app = yield* apps.create(actor, input)
    const owned = yield* uses.create(actor, { spaceId: ownerSpaceId, appId: app.id })
    expect(owned).toMatchObject({ id: SpaceApp.ofOwner(app.id), isOwner: true, pinnedReleaseId: null })
    const shared = yield* uses.create(actor, { spaceId: target, appId: app.id })
    expect(shared.isOwner).toBe(false)
    expect(yield* uses.create(actor, { spaceId: target, appId: app.id })).toEqual(shared)
    const foreign = yield* Seed.actor(yield* Seed.organization(), "admin")
    expect((yield* Effect.flip(apps.get(foreign, app.id)))._tag).toBe("Primitive.NotFound")
    expect((yield* Effect.flip(apps.update(foreign, app.id, { name: "Stolen" })))._tag).toBe("Primitive.NotFound")
    const updated = yield* apps.update(actor, app.id, { name: "New notes", icon: null })
    expect(updated).toMatchObject({
      latestReleaseId: app.latestReleaseId,
      description: "Write notes",
      name: "New notes",
      icon: null,
    })
    expect(
      (yield* database.db
        .select()
        .from(Database.Schema.app_release)
        .where(eq(Database.Schema.app_release.app_id, app.id))).length,
    ).toBe(1)
    expect((yield* database.db.select().from(Database.Schema.space_app)).length).toBe(1)
  }),
)
