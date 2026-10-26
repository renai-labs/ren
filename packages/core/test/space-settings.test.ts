import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { Space } from "../src/space.js"
import { SpaceSettings } from "../src/space/settings.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(SpaceSettings.layer, Space.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

const settings = { instructions: "We use Bun.", permissions: [], references: [] }

describe("SpaceSettings", () => {
  it.live("space members edit space settings; other members, admins included (AC4), get NotFound", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const space = yield* SpaceSettings.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "member")
      const grace = yield* Seed.actor(organizationId, "member")
      const admin = yield* Seed.actor(organizationId, "admin")
      const team = yield* spaces.create(ada, { name: "Team" })
      expect((yield* space.update(ada, team.id, { settings })).settings).toEqual(settings)
      expect((yield* Effect.flip(space.get(admin, team.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(space.get(grace, team.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(space.update(grace, team.id, { settings })))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("a space with no row reads as empty settings", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const space = yield* SpaceSettings.Service
      const ada = yield* Seed.actor(yield* Seed.organization(), "member")
      const team = yield* spaces.create(ada, { name: "Team" })
      expect(yield* space.get(ada, team.id)).toMatchObject({
        settings: { permissions: [], references: [] },
        updatedAt: null,
      })
    }),
  )
})
