export * as Usage from "./usage.js"

import { Database } from "@ren/db/database"
import { Usage } from "@ren/schema/usage"
import { Context, DateTime, Effect, Layer, Schema, Struct } from "effect"

export { Event } from "@ren/schema/usage"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Usage.Unavailable", {}) {}

export interface Interface {
  readonly record: (events: ReadonlyArray<Usage.Event>) => Effect.Effect<Usage.Recorded, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Usage") {}

const events = Database.Schema.usage_event

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    return Service.of({
      record: Effect.fn("Usage.record")(function* (batch) {
        const inserted = yield* database.db
          .insert(events)
          .values(batch.map((event) => Struct.assign(event, { time: DateTime.toDateUtc(event.time) })))
          .onConflictDoNothing()
          .returning({ id: events.id })
          .pipe(
            Effect.tapError(Effect.logError),
            Effect.mapError(() => new Unavailable()),
          )
        return { inserted: inserted.length }
      }),
    })
  }),
)
