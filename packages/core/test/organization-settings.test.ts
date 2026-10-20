import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { OrganizationSettings } from "../src/organization-settings.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  OrganizationSettings.layer.pipe(Layer.provideMerge(Access.layer), Layer.provideMerge(Testing.layer)),
)

const settings = {
  instructions: "Never print secrets.",
  permissions: [{ action: "webfetch", resource: "*", effect: "ask" as const }],
  references: [],
}

describe("OrganizationSettings", () => {
  it.live("only org admins edit org settings, and every member reads them", () =>
    Effect.gen(function* () {
      const organization = yield* OrganizationSettings.Service
      const organizationId = yield* Seed.organization()
      const admin = yield* Seed.actor(organizationId, "admin")
      const member = yield* Seed.actor(organizationId, "member")
      expect((yield* Effect.flip(organization.update(member, organizationId, { settings })))._tag).toBe(
        "Primitive.Forbidden",
      )
      const updated = yield* organization.update(admin, organizationId, { settings })
      expect(updated.settings).toEqual(settings)
      expect(yield* organization.get(member, organizationId)).toMatchObject({ settings, canUpdate: false })
      expect((yield* organization.get(admin, organizationId)).canUpdate).toBe(true)
    }),
  )

  it.live("an org with no row reads as empty settings", () =>
    Effect.gen(function* () {
      const organization = yield* OrganizationSettings.Service
      const organizationId = yield* Seed.organization()
      const member = yield* Seed.actor(organizationId, "member")
      expect(yield* organization.get(member, organizationId)).toMatchObject({
        settings: { permissions: [], references: [] },
        updatedAt: null,
      })
    }),
  )

  it.live("another org's settings are not found", () =>
    Effect.gen(function* () {
      const organization = yield* OrganizationSettings.Service
      const admin = yield* Seed.actor(yield* Seed.organization(), "admin")
      const other = yield* Seed.organization()
      expect((yield* Effect.flip(organization.get(admin, other)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(organization.update(admin, other, { settings })))._tag).toBe("Primitive.NotFound")
    }),
  )
})
