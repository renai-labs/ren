export * as WriteResult from "./write-result.js"

import { Schema } from "effect"

export interface Redirect extends Schema.Schema.Type<typeof Redirect> {}
export const Redirect = Schema.Struct({
  redirectUrl: Schema.String,
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "WriteResult.Redirect" })

export interface Upload extends Schema.Schema.Type<typeof Upload> {}
export const Upload = Schema.Struct({
  uploadId: Schema.String,
  uploadUrl: Schema.String,
  fields: Schema.Record(Schema.String, Schema.String).annotate({
    description: "The form fields to POST to `uploadUrl` before the file, which is the last field, named `file`.",
  }),
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "WriteResult.Upload" })

export const Secret = <Record extends Schema.Top>(record: Record) =>
  Schema.Struct({
    record,
    secret: Schema.String,
  })
