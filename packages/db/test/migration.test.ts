import { expect, test } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import { Config, Effect, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "../src/database.js"

const migrations = new URL("../migration", import.meta.url).pathname

test("the slugs migration gives each live space and schedule a unique slug in order of creation", async () => {
  await Effect.gen(function* () {
    const base = new URL(
      yield* Config.String("DATABASE_URL").pipe(Config.withDefault("postgres://ren:ren@localhost:54320/ren")),
    )
    const before = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "ren-migration-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    )
    const folders = yield* Effect.promise(() => readdir(migrations))
    yield* Effect.promise(() =>
      Promise.all(
        folders
          .filter((folder) => !folder.endsWith("_slugs"))
          .map((folder) => cp(join(migrations, folder), join(before, folder), { recursive: true })),
      ),
    )
    const admin = yield* SqlClient.SqlClient
    const name = `ren_test_migration_${crypto.randomUUID().replaceAll("-", "")}`
    yield* Effect.acquireRelease(admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`), () =>
      admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).pipe(Effect.orDie),
    )
    const target = new URL(base)
    target.pathname = `/${name}`
    const slugs = yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const sql = yield* SqlClient.SqlClient
      yield* migrate(database.db, { migrationsFolder: before })
      yield* sql`insert into "organization" ("id", "name", "slug", "created_at") values ('org_a', 'A', 'a', now()), ('org_b', 'B', 'b', now())`
      yield* sql`insert into "user" ("id", "name", "email", "created_at", "updated_at") values ('usr_a', 'Ada', 'ada@example.com', now(), now())`
      yield* sql`insert into "space" ("id", "organization_id", "name", "created_at", "archived_at") values
        ('spc_1', 'org_a', 'Team', '2026-01-01', null),
        ('spc_2', 'org_a', 'Team 2', '2026-01-02', null),
        ('spc_3', 'org_a', 'Team', '2026-01-03', null),
        ('spc_4', 'org_a', 'Team', '2026-01-04', '2026-02-01'),
        ('spc_5', 'org_a', '日本', '2026-01-05', null),
        ('spc_6', 'org_a', ${"Long ".repeat(20)}, '2026-01-06', null),
        ('spc_7', 'org_a', ${"Long ".repeat(20)}, '2026-01-07', null),
        ('spc_8', 'org_b', 'Team', '2026-01-08', null)`
      yield* sql`insert into "schedule" ("id", "organization_id", "space_id", "name", "owner_id", "cron", "time_zone", "message", "created_at") values
        ('sch_1', 'org_a', 'spc_1', 'Daily digest', 'usr_a', '0 9 * * *', 'UTC', 'Digest.', '2026-01-01'),
        ('sch_2', 'org_a', 'spc_1', 'Daily digest', 'usr_a', '0 9 * * *', 'UTC', 'Digest.', '2026-01-02'),
        ('sch_3', 'org_a', 'spc_3', 'Daily digest', 'usr_a', '0 9 * * *', 'UTC', 'Digest.', '2026-01-03'),
        ('sch_4', 'org_a', 'spc_1', '!!!', 'usr_a', '0 9 * * *', 'UTC', 'Digest.', '2026-01-04')`
      yield* migrate(database.db, { migrationsFolder: migrations })
      return {
        spaces: yield* sql<{ id: string; slug: string }>`select "id", "slug" from "space" order by "id"`,
        schedules: yield* sql<{ id: string; slug: string }>`select "id", "slug" from "schedule" order by "id"`,
      }
    }).pipe(Effect.provide(Database.layer), Effect.provide(PgClient.layer({ url: Redacted.make(target.href) })))
    const long = "long-".repeat(13).slice(0, 64).replace(/-+$/u, "")
    expect(slugs.spaces).toEqual([
      { id: "spc_1", slug: "team" },
      { id: "spc_2", slug: "team-2" },
      { id: "spc_3", slug: "team-3" },
      { id: "spc_4", slug: "team" },
      { id: "spc_5", slug: "space" },
      { id: "spc_6", slug: long },
      { id: "spc_7", slug: `${long.slice(0, 62).replace(/-+$/u, "")}-2` },
      { id: "spc_8", slug: "team" },
    ])
    expect(slugs.schedules).toEqual([
      { id: "sch_1", slug: "daily-digest" },
      { id: "sch_2", slug: "daily-digest-2" },
      { id: "sch_3", slug: "daily-digest" },
      { id: "sch_4", slug: "schedule" },
    ])
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
