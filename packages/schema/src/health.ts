export * as Health from "./health.js"

import { Schema } from "effect"

export const Status = Schema.Literals(["ok"]).annotate({ identifier: "Health.Status" })
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  status: Status,
  version: Schema.String,
}).annotate({ identifier: "Health.Info" })
