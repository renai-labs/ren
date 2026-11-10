export * as SearchProvider from "./search-provider.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
}).annotate({ identifier: "SearchProvider.Info" })

export const Providers = Schema.Array(Info)
  .check(
    Schema.makeFilter(
      (providers) =>
        new Set(providers.map((provider) => provider.id)).size === providers.length || "provider ids are unique",
    ),
  )
  .annotate({ identifier: "SearchProvider.Providers" })
export type Providers = typeof Providers.Type

export const Results = Schema.Array(
  Schema.Struct({
    url: Schema.String,
    title: Schema.optionalKey(Schema.String),
    content: Schema.optionalKey(Schema.String),
    time: Schema.Struct({ published: Schema.optionalKey(Schema.Number) }),
  }),
).annotate({ identifier: "SearchProvider.Results" })
