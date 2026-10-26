export * as Testing from "./testing.js"

import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { AuthDatabase } from "../../src/auth-database.js"
import { Database } from "../../src/database.js"
import { Template } from "./template.js"

const url = Config.String("DATABASE_URL").pipe(Config.withDefault("postgres://ren:ren@localhost:54320/ren"))

const prefix = "ren_test_clone_"

const collected = new Set<string>()

const Locked = Schema.Array(Schema.Struct({ locked: Schema.Boolean }))

export const collect = Effect.fn("TestDatabase.collect")(function* () {
  const sql = yield* SqlClient.SqlClient
  const connection = yield* sql.reserve
  const rows = yield* sql<{
    readonly name: string
  }>`select datname as name from pg_database where starts_with(datname, ${prefix})`
  yield* Effect.forEach(
    rows,
    (row) =>
      Effect.gen(function* () {
        const locked = yield* connection
          .execute("select pg_try_advisory_lock(hashtext($1)) as locked", [row.name], undefined)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Locked)), Effect.orDie)
        if (!locked.at(0)?.locked) return
        yield* sql
          .unsafe(`DROP DATABASE IF EXISTS "${row.name}" WITH (FORCE)`)
          .pipe(
            Effect.ensuring(
              connection.execute("select pg_advisory_unlock(hashtext($1))", [row.name], undefined).pipe(Effect.orDie),
            ),
          )
      }),
    { discard: true },
  )
})

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const base = new URL(yield* url)
    const admin = yield* Layer.build(PgClient.layer({ url: Redacted.make(base.href) }))
    const name = yield* Effect.gen(function* () {
      const template = yield* Template.timed("template", Template.prepare(base).pipe(Effect.scoped))
      if (!collected.has(base.href)) {
        collected.add(base.href)
        yield* Template.timed("collect", collect().pipe(Effect.scoped))
      }
      const sql = yield* SqlClient.SqlClient
      const connection = yield* sql.reserve
      const name = `${prefix}${crypto.randomUUID().replaceAll("-", "")}`
      yield* Effect.acquireRelease(connection.execute("select pg_advisory_lock(hashtext($1))", [name], undefined), () =>
        connection.execute("select pg_advisory_unlock(hashtext($1))", [name], undefined).pipe(Effect.orDie),
      )
      yield* Effect.acquireRelease(
        Template.timed("clone", sql.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`)),
        () => Template.timed("drop", sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).pipe(Effect.orDie),
      )
      return name
    }).pipe(Effect.provide(admin))
    const isolated = new URL(base)
    isolated.pathname = `/${name}`
    return AuthDatabase.make(Redacted.make(isolated.href)).pipe(
      Layer.provideMerge(Database.layer),
      Layer.provideMerge(PgClient.layer({ url: Redacted.make(isolated.href) })),
    )
  }),
)
