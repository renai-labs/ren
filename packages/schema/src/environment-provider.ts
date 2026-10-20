export * as EnvironmentProvider from "./environment-provider.js"

import { Schema } from "effect"

export const ID = Schema.NonEmptyString.pipe(
  Schema.brand("EnvironmentProvider.ID"),
  Schema.annotate({ identifier: "EnvironmentProvider.ID" }),
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
}).annotate({ identifier: "EnvironmentProvider.Info" })

export const Infos = Schema.Array(Info).annotate({ identifier: "EnvironmentProvider.Infos" })
