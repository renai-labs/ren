import { expect } from "bun:test"
import { testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { ApiFixture } from "@ren/server/testing/api"

const it = testEffect(ApiFixture.layer)

it.live("a seeded API caller uses real session authentication and observes revocation", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const response = yield* owner.request("GET", "/me")
    expect(response.status).toBe(200)
    expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
      user: { id: owner.createdBy },
      organization: { id: owner.organizationId },
    })
    const database = yield* Database.Service
    yield* database.db.delete(Database.Schema.session).where(eq(Database.Schema.session.userId, owner.createdBy))
    expect((yield* owner.request("GET", "/me")).status).toBe(401)
  }),
)
