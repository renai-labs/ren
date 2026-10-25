export * as BrainPush from "./brain-push.js"

import { PgClient } from "@effect/sql-pg"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Duration, Effect, Layer, Queue, Schedule } from "effect"
import { BrainHost } from "./brain-host.js"

export const channel = "ren_brains"

// oxlint-disable-next-line ren/no-comments -- HR12: a push storm reaches at most this many brains at a time.
const parallel = 16

// oxlint-disable-next-line ren/no-comments -- HR10, HR11, HR25: each server instance listens on ren_brains and tells every brain of a notified scope to pull. Notifications that arrive together are handled once per scope. A lost connection listens again; a notification during the gap is lost, and the brain's timed pull brings the change (HR8).
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient
    const database = yield* Database.Service
    const host = yield* BrainHost.Service
    const brains = Database.Schema.brain
    const idsOf = (scope: string) => {
      const query = database.db.select({ id: brains.id }).from(brains)
      if (scope === "all") return query
      const separator = scope.indexOf(":")
      const kind = scope.slice(0, separator)
      const id = scope.slice(separator + 1)
      if (kind === "space") return query.where(eq(brains.space_id, Space.ID.make(id)))
      if (kind === "org") return query.where(eq(brains.organization_id, Auth.OrganizationID.make(id)))
      return Effect.succeed([])
    }
    const push = Effect.fnUntraced(function* (scopes: ReadonlySet<string>) {
      const ids = new Set(
        (yield* Effect.forEach(scopes, (scope) => idsOf(scope).pipe(Effect.orDie))).flat().map((row) => row.id),
      )
      yield* Effect.forEach(ids, host.notify, { concurrency: parallel, discard: true })
    })
    yield* Effect.scoped(
      Effect.gen(function* () {
        const notifications = yield* pg.listen(channel)
        yield* Effect.logInfo(`Listening on ${channel}`)
        yield* Queue.takeAll(notifications).pipe(
          Effect.flatMap((all) => push(new Set(all.map((notification) => notification.payload)))),
          Effect.forever,
        )
      }),
    ).pipe(
      Effect.tapError((error) => Effect.logWarning(`The ${channel} listener stopped; it listens again`, error)),
      Effect.retry(Schedule.spaced(Duration.seconds(1))),
      Effect.forkScoped,
    )
  }),
)
