# Application SQLite migrations in artifacts

There are two independent kinds of migration:

- Cloudflare **class exports** provision the SQLite namespace for a Durable Object
  class. Ren manages them from `ren-artifact.json`; do not manage them in app SQL.
- Application SQL migrations change tables **inside each object's private SQLite
  database**. Your Worker runs these when that object initializes, not when Ren
  uploads the app. An unused object migrates only when it is next instantiated.

Keep ordered SQL strings and their runner in `_worker.js`. If using a source tree,
import the SQL as strings and bundle everything into that module before publishing.
Other artifact files are public assets. Ren does not execute loose `.sql` files,
parse arbitrary SQL on the server, or expose its filesystem to the app bundler.

## Small synchronous pattern

The existing `state-candidate` sample uses this pattern. It needs no ORM or new
runtime service. Drizzle's installed `durable-sqlite` migrator is an alternative
for apps already using and bundling Drizzle; it also delegates to
`storage.transactionSync`. Do not add an ORM solely for this small runner.

```js
import { DurableObject } from "cloudflare:workers"

const migrations = [
  { id: 1, sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, text TEXT NOT NULL);" },
  { id: 2, sql: "ALTER TABLE notes ADD COLUMN label TEXT NOT NULL DEFAULT '';" },
]

function migrate(storage, migrations) {
  storage.transactionSync(() => {
    const sql = storage.sql
    sql.exec("CREATE TABLE IF NOT EXISTS app_migrations (id INTEGER PRIMARY KEY, sql TEXT NOT NULL)")
    const applied = sql.exec("SELECT id, sql FROM app_migrations ORDER BY id").toArray()
    if (applied.length > migrations.length) throw new Error("Database schema is newer than this application")
    let index = 0
    for (const migration of migrations) {
      if (migration.id !== index + 1 || typeof migration.sql !== "string" || !migration.sql.trim())
        throw new Error("Migrations must have contiguous IDs starting at 1 and non-empty SQL")
      const existing = applied.at(index)
      index += 1
      if (existing) {
        if (existing.id !== migration.id || existing.sql !== migration.sql)
          throw new Error("Applied migrations are immutable")
        continue
      }
      sql.exec(migration.sql)
      sql.exec("INSERT INTO app_migrations (id, sql) VALUES (?, ?)", migration.id, migration.sql)
    }
  })
}

export class Notes extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    migrate(ctx.storage, migrations)
    this.sql = ctx.storage.sql
  }
  fetch() {
    return Response.json(this.sql.exec("SELECT id, text, label FROM notes").toArray())
  }
}

export default {
  fetch(request, env) {
    return env.NOTES.get(env.NOTES.idFromName("shared-notes")).fetch(request)
  },
}
```

Use `{"durableObjects":{"NOTES":"Notes"}}` in `ren-artifact.json`. This example
is synchronous: no `blockConcurrencyWhile`, `async` constructor work, `BEGIN`,
`COMMIT`, or custom SQL splitter is needed. `sql.exec` accepts multiple statements.
Do not return a Promise from `transactionSync`. Let migration errors escape the
constructor so a request cannot run on a partially migrated database.

## Update and rollback rules

- IDs start at 1 and are contiguous. Append new migrations; never reorder or
  renumber them. Applied SQL text is immutable, including whitespace. Keep a
  dedicated ledger table per independently migrated schema/class.
- All pending changes and their ledger entries commit in one transaction. If a
  statement fails, all pending SQL and ledger writes roll back. Earlier committed
  versions and existing application rows remain. Correct a migration only if it
  has **never** succeeded on any object; otherwise append a new corrective one.
- Restarts, object eviction, stop/redeploy and code updates rerun the constructor,
  but the ledger skips previously applied SQL. Do not rely on module globals or
  in-memory version counters for this.
- Prefer additive/backwards-compatible changes: new tables, nullable columns or
  columns with defaults, and staged data backfills. Deploy code that can tolerate
  both old and new schemas during rollout. Separate destructive cleanup from the
  first release that stops reading a column.
- There are no down migrations. Code recovery never rolls back application SQL.
  This strict runner rejects old code whose migration list omits an applied
  version or changes its text. A rollback-compatible release must retain the new
  migration list and tolerate its schema. After an irreversible change, roll
  forward instead of restoring an incompatible old bundle.
- Provider `ready` proves the uploaded Worker serves its platform marker, not
  that every dormant object has migrated. Smoke-test the actual application API
  after publishing. Existing objects migrate independently as they wake.
- Ren explicitly requests immediate DO code updates rather than Cloudflare's
  five-minute deferred default. An active object resets onto the new code, then
  its constructor runs migrations before handling requests. Global rollout can
  still briefly expose an older Worker/object pairing; keep interfaces compatible
  and observe the application's schema version when smoke-testing.

For an existing unversioned database, make migration 1 a deliberate baseline
matching its schema (`CREATE TABLE IF NOT EXISTS` can help when the schema truly
matches). Test against a preserved copy before adopting the ledger. Never clear
SQLite data or recreate the namespace to start version tracking.

## Verification

`ArtifactSamples.schemaUpgrade` runs against real local workerd and the opt-in
real Cloudflare provider. It exercises first initialization, an additive change
with old rows, stop/redeploy without reapplying `ALTER TABLE`, a failing migration
that must roll back both a new column and its ledger version, a corrected retry,
and rejection of older application code. Run locally from `packages/core`:

```sh
bun test ./test/artifacts.slow.test.ts --test-name-pattern 'per-object SQL'
```

Use the approved live commands in [Cloudflare hosting](artifact-cloudflare.md)
for the same scenario against ordinary Workers. These tests do not require D1 or
paid Workers for Platforms.

Official API contract: [transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).
