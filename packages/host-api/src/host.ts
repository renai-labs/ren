export * as Host from "./host.js"

import { Schema } from "effect"

export interface Refreshed extends Schema.Schema.Type<typeof Refreshed> {}
export const Refreshed = Schema.Struct({ hostToken: Schema.Redacted(Schema.NonEmptyString) }).annotate({
  identifier: "Host.Refreshed",
})
