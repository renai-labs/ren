import { expect, test } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { Config, Deferred, Effect, Exit, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { Testing } from "./lib/testing.js"

test("concurrent fixtures clone a prepared template and keep writes isolated", async () => {
  await Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const names = yield* Effect.all(
      ["first", "second"].map((value) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const names = yield* sql<{ name: string }>`select current_database() as name`
          yield* sql`create table fixture_probe (value text)`
          yield* sql`insert into fixture_probe values (${value})`
          if (value === "first") yield* Deferred.succeed(ready, undefined)
          else yield* Deferred.await(ready)
          expect(yield* sql<{ value: string }>`select value from fixture_probe`).toEqual([{ value }])
          expect(
            yield* sql`select datname from pg_database where datname like 'ren_test_template_%' and not datallowconn`,
          ).not.toHaveLength(0)
          return names[0]?.name
        }).pipe(Effect.provide(Testing.layer)),
      ),
      { concurrency: "unbounded" },
    )
    expect(new Set(names).size).toBe(2)
    const sql = yield* SqlClient.SqlClient
    expect(yield* sql`select datname from pg_database where datname in ${sql.in(names)}`).toHaveLength(0)
  }).pipe(
    Effect.provide(
      PgClient.layerConfig({
        url: Config.Redacted("DATABASE_URL").pipe(
          Config.withDefault(Redacted.make("postgres://ren:ren@localhost:54320/ren")),
        ),
      }),
    ),
    Effect.runPromise,
  )
})

test("failed test bodies release their database", async () => {
  const names: string[] = []
  const exit = await Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ name: string }>`select current_database() as name`
    names.push(...rows.map((row) => row.name))
    return yield* Effect.fail("fixture failure")
  }).pipe(Effect.provide(Testing.layer), Effect.runPromiseExit)
  expect(Exit.isFailure(exit)).toBe(true)
  expect(names).toHaveLength(1)
  await Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    expect(yield* sql`select datname from pg_database where datname in ${sql.in(names)}`).toHaveLength(0)
  }).pipe(Effect.provide(Testing.layer), Effect.runPromise)
})
