export * as Template from "./template.js"

import { PgClient } from "@effect/sql-pg"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import { Effect, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { Database } from "../../src/database.js"

const folder = new URL("../../migration", import.meta.url).pathname

export const timed = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    if (!process.env.REN_TEST_PROFILE) return effect
    const start = performance.now()
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() =>
          process.stderr.write(
            `${JSON.stringify({ harness: "database", phase, ms: Math.round(performance.now() - start) })}\n`,
          ),
        ),
      ),
    )
  })

export const key = Effect.fn("TestDatabase.key")(function* (migrationsFolder: string = folder) {
  const hash = new Bun.CryptoHasher("sha256").update("ren-test-template-v1")
  yield* Effect.promise(async () => {
    hash.update(await Bun.file(new URL("../../../../bun.lock", import.meta.url)).arrayBuffer())
    const files = [...new Bun.Glob("*/migration.sql").scanSync(migrationsFolder)].toSorted()
    const contents = await Promise.all(
      files.map(async (file) => [file, await Bun.file(`${migrationsFolder}/${file}`).text()]),
    )
    hash.update(JSON.stringify(contents))
  })
  const sql = yield* SqlClient.SqlClient
  const owner = yield* sql<{ name: string }>`select current_user as name`
  hash.update(owner[0]?.name ?? "")
  return `ren_test_template_${hash.digest("hex").slice(0, 24)}`
})

export const prepare = Effect.fn("TestDatabase.prepare")(function* (base: URL, migrationsFolder: string = folder) {
  const name = yield* key(migrationsFolder)
  const sql = yield* SqlClient.SqlClient
  const connection = yield* sql.reserve
  yield* Effect.acquireRelease(
    timed("template-lock", connection.executeRaw("select pg_advisory_lock(hashtext($1))", [name])),
    () => connection.executeRaw("select pg_advisory_unlock(hashtext($1))", [name]).pipe(Effect.orDie),
  )
  const existing = yield* sql`select datname from pg_database where datname = ${name} and not datallowconn`
  if (existing.length > 0) return name
  const building = `${name}_build`
  yield* sql.unsafe(`DROP DATABASE IF EXISTS "${building}" WITH (FORCE)`)
  yield* Effect.acquireRelease(sql.unsafe(`CREATE DATABASE "${building}" TEMPLATE template0`), () =>
    sql.unsafe(`DROP DATABASE IF EXISTS "${building}" WITH (FORCE)`).pipe(Effect.orDie),
  )
  const target = new URL(base)
  target.pathname = `/${building}`
  yield* timed(
    "migrate",
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* migrate(database.db, { migrationsFolder })
    }).pipe(Effect.provide(Database.layer), Effect.provide(PgClient.layer({ url: Redacted.make(target.href) }))),
  )
  if ((yield* key(migrationsFolder)) !== name) {
    return yield* Effect.die(new Error("Migrations changed while preparing the test database; run the tests again"))
  }
  yield* sql.unsafe(`ALTER DATABASE "${building}" ALLOW_CONNECTIONS false`)
  yield* sql.unsafe(`ALTER DATABASE "${building}" RENAME TO "${name}"`)
  return name
})
