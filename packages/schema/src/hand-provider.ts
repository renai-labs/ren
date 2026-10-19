export * as HandProvider from "./hand-provider.js"

import { Schema } from "effect"

export const ID = Schema.NonEmptyString.pipe(
  Schema.brand("HandProvider.ID"),
  Schema.annotate({ identifier: "HandProvider.ID" }),
)
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  description: Schema.String,
  configSchema: Schema.Json.annotate({
    description: "A JSON Schema document (draft 2020-12) of the provider’s config.",
  }),
}).annotate({ identifier: "HandProvider.Info" })

export const Infos = Schema.Array(Info).annotate({ identifier: "HandProvider.Infos" })
