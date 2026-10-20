export * as Testing from "./testing.js"

import { PgClient } from "@effect/sql-pg"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import { Config, Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { AuthDatabase } from "../../src/auth-database.js"
import { Database } from "../../src/database.js"

const url = Config.String("DATABASE_URL").pipe(Config.withDefault("postgres://ren:ren@localhost:54320/ren"))

const admin = (base: URL, statement: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql.unsafe(statement)
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(base.href) })))

const migrations = Layer.effectDiscard(
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* migrate(database.db, { migrationsFolder: new URL("../../migration", import.meta.url).pathname }).pipe(
      Effect.orDie,
    )
  }),
)

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const base = new URL(yield* url)
    const name = `ren_test_${crypto.randomUUID().replaceAll("-", "")}`
    yield* Effect.acquireRelease(admin(base, `CREATE DATABASE "${name}"`), () =>
      admin(base, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).pipe(Effect.orDie),
    )
    const isolated = new URL(base)
    isolated.pathname = `/${name}`
    return AuthDatabase.make(Redacted.make(isolated.href)).pipe(
      Layer.provideMerge(migrations),
      Layer.provideMerge(Database.layer),
      Layer.provideMerge(PgClient.layer({ url: Redacted.make(isolated.href) })),
    )
  }),
)
