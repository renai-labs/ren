export * as SessionStatus from "./session-status.js"

import { Schema } from "effect"

export interface RetryAction extends Schema.Schema.Type<typeof RetryAction> {}
export const RetryAction = Schema.Struct({
  reason: Schema.String,
  provider: Schema.String,
  title: Schema.String,
  message: Schema.String,
  label: Schema.String,
  link: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionStatus.RetryAction" })

export interface Idle extends Schema.Schema.Type<typeof Idle> {}
export const Idle = Schema.Struct({ type: Schema.tag("idle") }).annotate({ identifier: "SessionStatus.Idle" })

export interface Busy extends Schema.Schema.Type<typeof Busy> {}
export const Busy = Schema.Struct({ type: Schema.tag("busy") }).annotate({ identifier: "SessionStatus.Busy" })

export interface Retry extends Schema.Schema.Type<typeof Retry> {}
export const Retry = Schema.Struct({
  type: Schema.tag("retry"),
  attempt: Schema.Int,
  message: Schema.String,
  action: Schema.optionalKey(RetryAction),
  next: Schema.Int,
}).annotate({ identifier: "SessionStatus.Retry" })

export const Info = Schema.Union([Idle, Busy, Retry])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionStatus.Info" })
export type Info = Idle | Busy | Retry

export const Family = Schema.Record(Schema.String, Info).annotate({ identifier: "SessionStatus.Family" })
export type Family = typeof Family.Type
