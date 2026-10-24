import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Effect, Fiber, Layer, Result } from "effect"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppRelease } from "../src/app/release.js"
import { AppResolve } from "../src/app/resolve.js"
import { SpaceApp } from "../src/space/app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { AppGate } from "./lib/app-gate.js"

const it = testEffect(
  Layer.mergeAll(App.layer, AppRelease.layer, SpaceApp.layer, AppResolve.layer).pipe(
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

it.live("an install committed ahead of promotion is included in floating-consumer validation", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const releases = yield* AppRelease.Service
    const uses = yield* SpaceApp.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const consumer = yield* Seed.space(organizationId)
    const input = Seed.appInput(owner, "root")
    const root = yield* apps.create(actor, input)
    yield* apps.create(actor, Seed.appInput(owner, "dependency"))
    const release = yield* AppGate.hold({ organizationId })
    const install = yield* Effect.forkChild(uses.create(actor, { spaceId: consumer, appId: root.id }))
    yield* AppGate.waiters(1)
    const promotion = yield* Effect.forkChild(
      Effect.flip(
        releases.create(actor, {
          ...input,
          appId: root.id,
          expectedLatestReleaseId: root.latestReleaseId,
          dependsOn: ["dependency"],
        }),
      ),
    )
    yield* AppGate.waiters(2)
    yield* release
    const installed = yield* Fiber.join(install)
    const rejected = yield* Fiber.join(promotion)
    expect(rejected._tag).toBe("Primitive.Conflict")
    expect(rejected.message).toContain(consumer)
    expect((yield* uses.get(actor, installed.id)).release.id).toBe(root.latestReleaseId)
  }),
)

it.live("the unique index arbitrates cross-organization slug claims without partial app/release rows", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const database = yield* Database.Service
    const organizations = yield* Effect.forEach([1, 2], () => Seed.organization())
    const inputs = yield* Effect.forEach(
      organizations,
      Effect.fnUntraced(function* (organizationId) {
        return {
          actor: yield* Seed.actor(organizationId, "admin"),
          input: Seed.appInput(yield* Seed.space(organizationId), "contested"),
        }
      }),
    )
    const gates = yield* Effect.forEach(organizations, (organizationId) => AppGate.hold({ organizationId }))
    const writes = yield* Effect.forEach(inputs, (entry) =>
      Effect.forkChild(Effect.result(apps.create(entry.actor, entry.input))),
    )
    yield* AppGate.waiters(2)
    yield* Effect.all(gates, { concurrency: "unbounded" })
    const results = yield* Effect.forEach(writes, Fiber.join)
    expect(results.filter(Result.isSuccess).length).toBe(1)
    expect(results.filter(Result.isFailure).map((entry) => entry.failure._tag)).toEqual(["Primitive.Conflict"])
    expect((yield* database.db.select().from(Database.Schema.app)).length).toBe(1)
    expect((yield* database.db.select().from(Database.Schema.app_release)).length).toBe(1)
  }),
)

it.live("an organization graph lock does not block its catalog reads, another organization or metadata edits", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const resolver = yield* AppResolve.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const app = yield* apps.create(actor, Seed.appInput(owner, "locked"))
    const otherActor = yield* Seed.actor(yield* Seed.organization(), "admin")
    const otherSpace = yield* Seed.space(otherActor.organizationId)
    const release = yield* AppGate.hold({ organizationId })
    const work = yield* Effect.forkChild(
      Effect.gen(function* () {
        expect((yield* resolver.forSpace(owner)).catalog.apps.at(0)?.appId).toBe(app.id)
        yield* apps.create(otherActor, Seed.appInput(otherSpace, "independent"))
        yield* resolver.forSpace(otherSpace)
        yield* apps.update(actor, app.id, { name: "Updated" })
      }),
    )
    const completed = yield* Effect.race(
      Fiber.join(work).pipe(Effect.as(true)),
      AppGate.waiters(1).pipe(Effect.as(false)),
    )
    yield* release
    yield* Fiber.join(work)
    expect(completed).toBe(true)
  }),
)

it.live("racing installs reuse one identity and racing successors cannot overwrite the winner", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const releases = yield* AppRelease.Service
    const uses = yield* SpaceApp.Service
    const database = yield* Database.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* Seed.actor(organizationId, "admin")
    const owner = yield* Seed.space(organizationId)
    const target = yield* Seed.space(organizationId)
    const input = Seed.appInput(owner, "racing")
    const app = yield* apps.create(actor, input)
    const installs = yield* Effect.all(
      [uses.create(actor, { spaceId: target, appId: app.id }), uses.create(actor, { spaceId: target, appId: app.id })],
      { concurrency: "unbounded" },
    )
    expect(installs.at(0)?.id).toBe(installs.at(1)?.id)
    expect((yield* database.db.select().from(Database.Schema.space_app)).length).toBe(1)
    const successors = yield* Effect.forEach(
      ["one", "two"],
      (value) =>
        Effect.result(
          releases.create(actor, {
            ...input,
            appId: app.id,
            expectedLatestReleaseId: app.latestReleaseId,
            environment: { packages: {}, buildCommands: [value] },
          }),
        ),
      { concurrency: "unbounded" },
    )
    expect(successors.filter(Result.isSuccess).length).toBe(1)
    expect(successors.filter(Result.isFailure).map((entry) => entry.failure._tag)).toEqual(["Primitive.Conflict"])
    expect((yield* database.db.select().from(Database.Schema.app_release)).length).toBe(2)
  }),
)
