export * as Testing from "./testing.js"

import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { AuthDatabase } from "../../src/auth-database.js"
import { Database } from "../../src/database.js"
import { Template } from "./template.js"

const url = Config.String("DATABASE_URL").pipe(Config.withDefault("postgres://ren:ren@localhost:54320/ren"))

const admin = (base: URL, statement: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql.unsafe(statement)
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(base.href) })))

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const base = new URL(yield* url)
    const template = yield* Template.timed(
      "template",
      Template.prepare(base).pipe(Effect.scoped, Effect.provide(PgClient.layer({ url: Redacted.make(base.href) }))),
    )
    const name = `ren_test_${crypto.randomUUID().replaceAll("-", "")}`
    yield* Effect.acquireRelease(
      Template.timed("clone", admin(base, `CREATE DATABASE "${name}" TEMPLATE "${template}"`)),
      () => Template.timed("drop", admin(base, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).pipe(Effect.orDie),
    )
    const isolated = new URL(base)
    isolated.pathname = `/${name}`
    return AuthDatabase.make(Redacted.make(isolated.href)).pipe(
      Layer.provideMerge(Database.layer),
      Layer.provideMerge(PgClient.layer({ url: Redacted.make(isolated.href) })),
    )
  }),
)
