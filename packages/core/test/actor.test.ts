import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Actor } from "../src/actor.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Actor.layer.pipe(Layer.provideMerge(Testing.layer)))

it.live("a host actor uses the session creator's current membership and refuses a foreign organization", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const actors = yield* Actor.Service
    yield* Seed.ren()
    const organizationId = yield* Seed.organization()
    const user = yield* Seed.actor(organizationId, "admin")
    const spaceId = yield* Seed.space(organizationId)
    const sessionId = yield* Seed.session({ organizationId, spaceId, createdBy: user.userId })
    const actor = yield* actors.fromHost({ sessionId, organizationId })
    expect(actor).toMatchObject({ userId: user.userId, roles: ["admin"], agent: { sessionId, spaceId } })
    expect(
      (yield* Effect.flip(actors.fromHost({ sessionId, organizationId: Auth.OrganizationID.create() })))._tag,
    ).toBe("Primitive.Forbidden")
    yield* database.db.delete(Database.Schema.member).where(eq(Database.Schema.member.userId, user.userId))
    expect((yield* Effect.flip(actors.fromHost({ sessionId, organizationId })))._tag).toBe("Primitive.Forbidden")
  }),
)
