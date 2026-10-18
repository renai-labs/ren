export * as Permission from "./permission.js"

import { Schema } from "effect"
import { Session } from "./session.js"

export const RequestID = Schema.String.check(Schema.isStartingWith("per")).pipe(
  Schema.brand("Permission.RequestID"),
  Schema.annotate({ identifier: "Permission.RequestID" }),
)
export type RequestID = typeof RequestID.Type

export interface Source extends Schema.Schema.Type<typeof Source> {}
export const Source = Schema.Struct({
  type: Schema.Literal("tool"),
  messageID: Schema.String,
  id: Schema.String,
}).annotate({ identifier: "Permission.Source" })

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  id: RequestID,
  sessionID: Session.ID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Schema.optionalKey(Schema.Array(Schema.String)),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  source: Schema.optionalKey(Source),
  message: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Permission.Request" })

export const Reply = Schema.Literals(["once", "always", "reject"]).annotate({ identifier: "Permission.Reply" })
export type Reply = typeof Reply.Type
