import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { AuthDatabase } from "../src/auth-database.js"
import { user } from "../src/auth.sql.js"
import { Database } from "../src/database.js"
import { Testing } from "../src/testing.js"

test("provides drizzle on an isolated database", async () => {
  const rows = await Effect.gen(function* () {
    yield* Database.Service
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ name: string }>`select current_database() as name`
  }).pipe(Effect.provide(Testing.layer), Effect.runPromise)

  expect(rows[0]?.name).toStartWith("ren_test_")
})

test("applies migrations and shares the database with the auth connection", async () => {
  const rows = await Effect.gen(function* () {
    const auth = yield* AuthDatabase.Service
    yield* Effect.promise(() =>
      auth.db.insert(user).values({
        id: "usr_1",
        name: "Ada",
        email: "ada@example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ email: string }>`select email from "user"`
  }).pipe(Effect.provide(Testing.layer), Effect.runPromise)

  expect(rows).toEqual([{ email: "ada@example.com" }])
})
