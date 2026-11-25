import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { ReferenceCheck } from "../src/reference-check.js"
import { Access } from "../src/access.js"
import { OrganizationSettings } from "../src/organization-settings.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  OrganizationSettings.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Access.layer, ReferenceCheck.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

const settings = {
  instructions: "Never print secrets.",
  permissions: [{ action: "webfetch", resource: "*", effect: "ask" as const }],
  references: [],
}

describe("OrganizationSettings", () => {
  it.live("an org reads empty settings until an admin edits them; only admins edit, and every member reads", () =>
    Effect.gen(function* () {
      const organization = yield* OrganizationSettings.Service
      const organizationId = yield* Seed.organization()
      const admin = yield* Seed.actor(organizationId, "admin")
      const member = yield* Seed.actor(organizationId, "member")
      expect(yield* organization.get(member, organizationId)).toMatchObject({
        settings: { permissions: [], references: [] },
        updatedAt: null,
      })
      expect((yield* Effect.flip(organization.update(member, organizationId, { settings })))._tag).toBe(
        "Primitive.Forbidden",
      )
      const updated = yield* organization.update(admin, organizationId, { settings })
      expect(updated.settings).toEqual(settings)
      expect(yield* organization.get(member, organizationId)).toMatchObject({ settings, canUpdate: false })
      expect((yield* organization.get(admin, organizationId)).canUpdate).toBe(true)
    }),
  )

  it.live("the org's slug names its settings; another org's settings are not found, by ID or slug", () =>
    Effect.gen(function* () {
      const organization = yield* OrganizationSettings.Service
      const own = yield* Seed.organization()
      const admin = yield* Seed.actor(own, "admin")
      const other = yield* Seed.organization()
      expect((yield* organization.get(admin, own.toLowerCase())).id).toBe(own)
      expect((yield* Effect.flip(organization.get(admin, other)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(organization.get(admin, other.toLowerCase())))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(organization.update(admin, other, { settings })))._tag).toBe("Primitive.NotFound")
    }),
  )
})
