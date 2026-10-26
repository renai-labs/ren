import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { Testing } from "./testing.js"

await Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly name: string }>`select current_database() as name`
  process.stdout.write(rows.at(0)?.name ?? "")
  yield* Effect.promise(() => Bun.stdin.text())
}).pipe(Effect.provide(Testing.layer), Effect.runPromise)
