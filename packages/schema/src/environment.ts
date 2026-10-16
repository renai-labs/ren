export * as Environment from "./environment.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("env", "Environment.ID")
export type ID = typeof ID.Type

export interface Location extends Schema.Schema.Type<typeof Location> {}
export const Location = Schema.Struct({
  environmentId: ID,
  directory: Schema.String.check(Schema.isStartingWith("/")),
}).annotate({ identifier: "Environment.Location" })

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  environmentId: ID,
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.DateTimeUtc,
  generation: Schema.Int.annotate({
    description:
      "Machine generation. Increases when the machine backing the environment is replaced, not when its token is refreshed.",
  }),
}).annotate({ identifier: "Environment.Access" })
