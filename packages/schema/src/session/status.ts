export * as SessionStatus from "./status.js"

import { Schema } from "effect"

export interface Idle extends Schema.Schema.Type<typeof Idle> {}
export const Idle = Schema.Struct({ type: Schema.tag("idle") }).annotate({ identifier: "SessionStatus.Idle" })

export interface Busy extends Schema.Schema.Type<typeof Busy> {}
export const Busy = Schema.Struct({ type: Schema.tag("busy") }).annotate({ identifier: "SessionStatus.Busy" })

export const Info = Schema.Union([Idle, Busy])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionStatus.Info" })
export type Info = Idle | Busy

export const Family = Schema.Record(Schema.String, Info).annotate({ identifier: "SessionStatus.Family" })
export type Family = typeof Family.Type
