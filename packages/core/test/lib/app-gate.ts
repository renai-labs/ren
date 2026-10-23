export * as AppGate from "./app-gate.js"

import { Deferred, Effect, Fiber } from "effect"
import { SqlClient } from "effect/sql"
import type { Auth } from "@ren/schema/auth"
import { AppQueries } from "../../src/app/queries.js"

export const hold = Effect.fnUntraced(function* (options: { readonly organizationId: Auth.OrganizationID }) {
  const sql = yield* SqlClient.SqlClient
  const locked = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
  const fiber = yield* Effect.forkChild(
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`select pg_advisory_xact_lock(${AppQueries.gate.namespace}::int, hashtext(${options.organizationId}))`
        yield* Deferred.succeed(locked, undefined)
        yield* Deferred.await(release)
      }),
    ),
  )
  yield* Deferred.await(locked)
  return Deferred.succeed(release, undefined).pipe(Effect.andThen(Fiber.join(fiber)))
})

export const waiters = Effect.fnUntraced(function* (count: number) {
  const sql = yield* SqlClient.SqlClient
  yield* sql<{
    readonly waiting: number
  }>`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`.pipe(
    Effect.repeat({ until: (rows) => (rows.at(0)?.waiting ?? 0) >= count }),
  )
})
