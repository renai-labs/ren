import { expect, test } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Exit, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Template } from "./lib/template.js"

test("concurrent builders publish once, reuse the template, and invalidate changed migrations", async () => {
  await Effect.gen(function* () {
    const base = new URL(
      yield* Config.String("DATABASE_URL").pipe(Config.withDefault("postgres://ren:ren@localhost:54320/ren")),
    )
    const folder = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "ren-template-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    )
    const file = `${folder}/20261011065914_test/migration.sql`
    const marker = crypto.randomUUID()
    yield* Effect.promise(() => Bun.write(file, `CREATE TABLE probe_${marker.replaceAll("-", "")} (id integer);`))
    const names: string[] = []
    const sql = yield* SqlClient.SqlClient
    yield* Effect.addFinalizer(() =>
      Effect.forEach([...new Set(names)], (name) => sql.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)).pipe(
        Effect.orDie,
      ),
    )
    const prepare = Template.prepare(base, folder).pipe(
      Effect.scoped,
      Effect.tap((name) => Effect.sync(() => names.push(name))),
      Effect.provide(PgClient.layer({ url: Redacted.make(base.href) })),
    )
    const concurrent = yield* Effect.all([prepare, prepare, prepare], { concurrency: "unbounded" })
    expect(new Set(concurrent).size).toBe(1)
    const before = yield* sql`select oid from pg_database where datname = ${concurrent[0]}`
    expect(yield* prepare).toBe(concurrent[0])
    expect(yield* sql`select oid from pg_database where datname = ${concurrent[0]}`).toEqual(before)
    yield* Effect.promise(() => Bun.write(file, `CREATE TABLE changed_${marker.replaceAll("-", "")} (id integer);`))
    expect(yield* prepare).not.toBe(concurrent[0])
  }).pipe(
    Effect.scoped,
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

test("failed migrations release the build lock and do not publish a template", async () => {
  await Effect.gen(function* () {
    const base = new URL(
      yield* Config.String("DATABASE_URL").pipe(Config.withDefault("postgres://ren:ren@localhost:54320/ren")),
    )
    const folder = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "ren-template-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    )
    yield* Effect.promise(() =>
      Bun.write(
        `${folder}/20261011065914_test/migration.sql`,
        `SELECT missing_${crypto.randomUUID().replaceAll("-", "")}();`,
      ),
    )
    const sql = yield* SqlClient.SqlClient
    const name = yield* Template.key(folder)
    const prepare = Template.prepare(base, folder).pipe(Effect.scoped, Effect.exit)
    expect(Exit.isFailure(yield* prepare)).toBe(true)
    expect(Exit.isFailure(yield* prepare)).toBe(true)
    expect(
      yield* sql`select datname from pg_database where datname in ${sql.in([name, `${name}_build`])}`,
    ).toHaveLength(0)
  }).pipe(
    Effect.scoped,
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
