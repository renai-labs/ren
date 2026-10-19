export * as SessionModel from "./session-model.js"

import { Schema } from "effect"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  variant: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionModel.Ref" })

export interface Variant extends Schema.Schema.Type<typeof Variant> {}
export const Variant = Schema.Struct({ id: Schema.String }).annotate({ identifier: "SessionModel.Variant" })

export interface Choice extends Schema.Schema.Type<typeof Choice> {}
export const Choice = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  name: Schema.String,
  variants: Schema.Array(Variant),
}).annotate({ identifier: "SessionModel.Choice" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ...Choice.fields,
  input: Schema.Array(Schema.String),
  limit: Schema.Struct({ context: Schema.Int, output: Schema.Int }),
}).annotate({ identifier: "SessionModel.Info" })

export const key = (ref: Pick<Ref, "id" | "providerID">) => `${ref.providerID}/${ref.id}`
