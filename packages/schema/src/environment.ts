export * as Environment from "./environment.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("env", "Environment.ID")
export type ID = typeof ID.Type

export const Directory = Schema.String.check(Schema.isStartingWith("/")).annotate({
  identifier: "Environment.Directory",
})
export type Directory = typeof Directory.Type

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  directory: Directory,
  url: Schema.URL,
  token: Schema.Redacted(Schema.String),
  expiresAt: Schema.DateTimeUtc,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "Increases each time Ren gives the session another environment, not when its token is refreshed.",
  }),
}).annotate({ identifier: "Environment.Access" })
