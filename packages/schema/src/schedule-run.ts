export * as ScheduleRun from "./schedule-run.js"

import { Schema } from "effect"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Schedule } from "./schedule.js"
import { Session } from "./session.js"

export const ID = Schedule.RunID
export type ID = Schedule.RunID

export const Trigger = Schema.Literals(["timed", "manual"]).annotate({
  identifier: "ScheduleRun.Trigger",
  description: "`timed`: its time came. `manual`: a person or an agent ran it now.",
})
export type Trigger = typeof Trigger.Type

export const Status = Schedule.RunStatus
export type Status = Schedule.RunStatus

export const Reason = Schema.Literals([
  "previous_run_busy",
  "paused",
  "archived",
  "owner_left",
  "agent_removed",
  "chat_archived",
]).annotate({ identifier: "ScheduleRun.Reason", description: "Why a run was skipped." })
export type Reason = typeof Reason.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  scheduleId: Schedule.ID,
  scheduledAt: Schema.DateTimeUtc,
  startedAt: Schema.NullOr(Schema.DateTimeUtc),
  trigger: Trigger,
  status: Status,
  reason: Schema.NullOr(Reason),
  error: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Session.ID).annotate({
    description: "The chat that the run started or sent to. Null when it reached no chat, such as a skipped run.",
  }),
}).annotate({ identifier: "ScheduleRun.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  scheduleId: Schedule.ID,
  status: Schema.optional(Status),
  ...Pagination.fields(50),
}).annotate({
  identifier: "ScheduleRun.ListInput",
  description: "The runs of one schedule in the last 30 days, newest first.",
})

const Page = Pagination.Page(Info).annotate({ identifier: "ScheduleRun.Page" })

export const definition = Primitive.define({
  name: "schedule-run",
  plural: "schedule-runs",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
})
