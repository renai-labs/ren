export * as Environment from "./environment.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import type { Session } from "./session.js"

export const ID = Identifier.make("env", "Environment.ID")
export type ID = typeof ID.Type

export const sessionDirectory = (sessionId: Session.ID) => `/workspace/${sessionId}`

export interface Location extends Schema.Schema.Type<typeof Location> {}
export const Location = Schema.Struct({
  environmentId: ID,
  directory: Schema.String.check(Schema.isStartingWith("/")),
}).annotate({ identifier: "Environment.Location" })

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  environmentId: ID,
  directory: Schema.String.check(Schema.isStartingWith("/")),
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.DateTimeUtc,
  generation: Schema.Int.annotate({
    description:
      "Sandbox generation. Increases when Ren replaces the sandbox of the session, not when its token is refreshed.",
  }),
}).annotate({ identifier: "Environment.Access" })
