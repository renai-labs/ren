export * as SessionError from "./session-error.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))),
  response: Schema.optionalKey(Schema.Struct({ body: Schema.String })),
}).annotate({ identifier: "SessionError.Info" })
