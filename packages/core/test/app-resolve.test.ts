import { expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
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

it.live(
  "catalogs select each space's versions, fingerprint execution only and remove only the removed app's entries",
  () =>
    Effect.gen(function* () {
      const apps = yield* App.Service
      const releases = yield* AppRelease.Service
      const uses = yield* SpaceApp.Service
      const resolver = yield* AppResolve.Service
      const organizationId = yield* Seed.organization()
      const actor = yield* Seed.actor(organizationId, "admin")
      const owner = yield* Seed.space(organizationId)
      const target = yield* Seed.space(organizationId)
      const input = Seed.appInput(owner, "notes", {
        skills: {
          notes: { type: "content", description: "Notes", instructions: "First", files: {}, requiredCredentials: [] },
        },
      })
      const app = yield* apps.create(actor, input)
      const pinned = yield* uses.create(actor, { spaceId: target, appId: app.id, pinnedReleaseId: app.latestReleaseId })
      const initial = yield* resolver.forSpace(target)
      expect(initial.catalog.skills.map((entry) => entry.slug)).toEqual(["notes"])
      expect(yield* resolver.forSpace(target)).toEqual(initial)
      expect(yield* resolver.revision(target)).toBe(initial.fingerprint)
      yield* apps.update(actor, app.id, { name: "Updated metadata" })
      expect(yield* resolver.revision(target)).toBe(initial.fingerprint)
      const next = yield* releases.create(actor, {
        ...input,
        appId: app.id,
        expectedLatestReleaseId: app.latestReleaseId,
        skills: {
          notes: { type: "content", description: "Notes", instructions: "Second", files: {}, requiredCredentials: [] },
        },
      })
      const owned = yield* resolver.forSpace(owner)
      expect(owned.catalog.skills.at(0)?.releaseId).toBe(next.id)
      expect(yield* resolver.revision(owner)).toBe(owned.fingerprint)
      expect(yield* resolver.revision(target)).toBe(initial.fingerprint)
      const other = yield* apps.create(
        actor,
        Seed.appInput(owner, "other", {
          skills: {
            "n-otes": {
              type: "upstream",
              upstream: { url: "https://github.com/acme/skills", path: "." },
              requiredCredentials: [],
            },
          },
        }),
      )
      yield* uses.create(actor, { spaceId: target, appId: other.id })
      yield* uses.archive(actor, pinned.id)
      const final = yield* resolver.forSpace(target)
      expect(final.catalog.skills.map((entry) => entry.slug)).toEqual(["n-otes"])
      expect(final.fingerprint).not.toBe(initial.fingerprint)
      expect(yield* resolver.revision(target)).toBe(final.fingerprint)
    }),
)
