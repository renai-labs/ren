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

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  id: Schema.NonEmptyString,
  secret: Schema.String.check(Schema.isMinLength(32)),
}).annotate({ identifier: "CellToken.Key" })

export const Keys = Schema.fromJsonString(
  Schema.NonEmptyArray(Key).check(
    Schema.makeFilter((keys) => new Set(keys.map((key) => key.id)).size === keys.length || "key ids must be unique"),
  ),
).annotate({ identifier: "CellToken.Keys" })
