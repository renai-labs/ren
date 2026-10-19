export * as Hand from "./hand.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("hnd", "Hand.ID")
export type ID = typeof ID.Type

export const ProviderID = Schema.NonEmptyString.pipe(
  Schema.brand("Hand.ProviderID"),
  Schema.annotate({ identifier: "Hand.ProviderID" }),
)
export type ProviderID = typeof ProviderID.Type

export interface ProviderInfo extends Schema.Schema.Type<typeof ProviderInfo> {}
export const ProviderInfo = Schema.Struct({
  id: ProviderID,
  title: Schema.String,
  description: Schema.String,
  configSchema: Schema.Json.annotate({
    description: "A JSON Schema document (draft 2020-12) of the provider’s config.",
  }),
}).annotate({ identifier: "Hand.ProviderInfo" })

export const Providers = Schema.Array(ProviderInfo).annotate({ identifier: "Hand.Providers" })

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  directory: Schema.String.check(Schema.isStartingWith("/")),
  url: Schema.String,
  token: Schema.Redacted(Schema.String),
  expiresAt: Schema.DateTimeUtc,
  generation: Schema.Int.annotate({
    description: "Increases each time Ren gives the session another hand, not when its token is refreshed.",
  }),
}).annotate({ identifier: "Hand.Access" })
