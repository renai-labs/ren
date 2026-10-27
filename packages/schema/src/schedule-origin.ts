export * as ScheduleOrigin from "./schedule-origin.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  scheduleId: Schema.String,
  name: Schema.String,
  scheduledAt: Schema.String.annotate({ description: "The time the run was for, as an ISO 8601 instant." }),
}).annotate({
  identifier: "ScheduleOrigin.Info",
  description: "The schedule that sent a message, and the time the run was for.",
})
