import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
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
