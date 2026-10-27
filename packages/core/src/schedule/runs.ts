export * as ScheduleRuns from "./runs.js"

import { Database } from "@ren/db/database"
import type { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Session } from "@ren/schema/session"
import { DurableRunner } from "../durable-runner.js"

export const FireRun = DurableRunner.make("ScheduleFire", {
  payload: { runId: ScheduleRun.ID },
  idempotencyKey: (payload) => payload.runId,
})

// oxlint-disable-next-line ren/no-comments -- S1, S14: one pending run per fire, with its chat and message ids chosen once; a timed fire that already has a run inserts nothing.
export const insert = (
  transaction: Pick<Database.Transaction, "insert">,
  scheduleId: Schedule.ID,
  scheduledAt: Date,
  trigger: ScheduleRun.Trigger,
) =>
  transaction
    .insert(Database.Schema.schedule_run)
    .values({
      id: ScheduleRun.ID.create(),
      schedule_id: scheduleId,
      scheduled_at: scheduledAt,
      trigger,
      session_id: Session.ID.create(),
      message_id: Session.MessageID.create(),
    })
    .onConflictDoNothing()
