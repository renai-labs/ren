export * as CellToken from "./cell-token.js"

import { Schema } from "effect"

export const Scope = Schema.Literals(["server", "client"]).annotate({ identifier: "CellToken.Scope" })
export type Scope = typeof Scope.Type

export interface Payload extends Schema.Schema.Type<typeof Payload> {}
export const Payload = Schema.Struct({
  kid: Schema.NonEmptyString,
  sid: Schema.String.check(Schema.isStartingWith("ses_")),
  scope: Scope,
  exp: Schema.Int,
}).annotate({ identifier: "CellToken.Payload" })
