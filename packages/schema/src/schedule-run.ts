export * as ScheduleRun from "./schedule-run.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Schedule } from "./schedule.js"
import { Session } from "./session.js"

export const ID = Identifier.make("srn", "ScheduleRun.ID")
export type ID = typeof ID.Type

export const Trigger = Schema.Literals(["timed", "manual"]).annotate({
  identifier: "ScheduleRun.Trigger",
  description: "`timed`: its time came. `manual`: a person or an agent ran it now.",
})
export type Trigger = typeof Trigger.Type

export const Status = Schema.Literals(["pending", "started", "skipped", "failed"]).annotate({
  identifier: "ScheduleRun.Status",
})
export type Status = typeof Status.Type

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
  sessionId: Session.ID.annotate({ description: "The chat that the run started or sent to." }),
}).annotate({ identifier: "ScheduleRun.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  scheduleId: Schedule.ID,
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
