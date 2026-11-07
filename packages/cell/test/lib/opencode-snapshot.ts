export * as OpenCodeSnapshot from "./opencode-snapshot.js"

import { Schema } from "effect"

export const Snapshot = Schema.Struct({
  version: Schema.String,
  root: Schema.String,
  tables: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      sql: Schema.String,
      rows: Schema.Array(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Null]))),
    }),
  ),
  indexes: Schema.Array(Schema.String),
})
