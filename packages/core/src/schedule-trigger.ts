export * as ScheduleTrigger from "./schedule-trigger.js"

import { Database } from "@ren/db/database"
import type { Schedule } from "@ren/schema/schedule"
import { and, asc, eq, isNull, lte } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { ScheduleRuns } from "./schedule/runs.js"
import { ScheduleTime } from "./schedule/time.js"

// oxlint-disable-next-line ren/no-comments -- Decides when a schedule fires, and records each fire as a pending run. Schedules runs the pending runs; a provider never starts a chat.
export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- A schedule was created, changed, paused, resumed or archived. A provider that keeps its own copy (Temporal Schedules, an alarm) updates it from the row.
  readonly changed: (scheduleId: Schedule.ID) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- Record every fire that is due now. Schedules calls it before it runs the pending runs; a provider that pushes its fires does nothing here.
  readonly claim: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ScheduleTrigger") {}

const schedule = Database.Schema.schedule

// oxlint-disable-next-line ren/no-comments -- S1, S2: the schedule row is the only copy; a claim takes due rows FOR UPDATE SKIP LOCKED, so two Ren servers record each fire once.
export const layerPostgres = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return Service.of({
      changed: () => Effect.void,
      claim: Effect.gen(function* () {
        const at = new Date(yield* Clock.currentTimeMillis)
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const due = yield* transaction
              .select()
              .from(schedule)
              .where(and(lte(schedule.next_run_at, at), isNull(schedule.archived_at), isNull(schedule.paused_reason)))
              .orderBy(asc(schedule.next_run_at))
              .limit(100)
              .for("update", { skipLocked: true })
            yield* Effect.forEach(
              due,
              (row) =>
                Effect.gen(function* () {
                  yield* ScheduleRuns.insert(transaction, row.id, ScheduleTime.latestFire(row, at), "timed")
                  yield* transaction
                    .update(schedule)
                    .set({ next_run_at: Option.getOrNull(ScheduleTime.nextFire(row, at)) })
                    .where(eq(schedule.id, row.id))
                }),
              { discard: true },
            )
          }),
        )
      }).pipe(Effect.withSpan("ScheduleTrigger.claim")),
    })
  }),
)
