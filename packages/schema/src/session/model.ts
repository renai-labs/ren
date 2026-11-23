export * as SessionModel from "./model.js"

import { Schema } from "effect"
import { Models } from "../models.js"

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
  providerName: Schema.optionalKey(Schema.String).annotate({
    description: "The card of the Providers page the model comes from. Omitted by an older Ren.",
  }),
  method: Schema.optionalKey(Models.Method),
  price: Schema.optionalKey(Models.Price).annotate({ description: "Only for Ren’s models, which Ren charges for." }),
  free: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "SessionModel.Choice" })

// oxlint-disable-next-line ren/no-comments -- Providers §5.3: what a picker row shows beside the model's name, from the card and the model of Ren's list.
export const listed = (
  endpoint: Models.CatalogEndpoint,
  model: Models.Info,
): Pick<Choice, "providerName" | "method" | "price" | "free"> => ({
  ...(endpoint.name && { providerName: endpoint.name }),
  ...(endpoint.method && { method: endpoint.method }),
  ...(model.price && { price: model.price }),
  ...(model.free && { free: true }),
})

export interface Choices extends Schema.Schema.Type<typeof Choices> {}
export const Choices = Schema.Struct({
  models: Schema.Array(Choice),
  default: Schema.optionalKey(Ref).annotate({ description: "The model a session starts with when it names none." }),
}).annotate({ identifier: "SessionModel.Choices" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ...Choice.fields,
  input: Schema.Array(Schema.String),
  limit: Schema.Struct({ context: Schema.Int, output: Schema.Int }),
}).annotate({ identifier: "SessionModel.Info" })

export const key = (ref: Pick<Ref, "id" | "providerID">) => `${ref.providerID}/${ref.id}`
