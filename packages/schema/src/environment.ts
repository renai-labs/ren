export * as Environment from "./environment.js"

import { Effect, Schema } from "effect"
import type { Brain } from "./brain.js"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("env", "Environment.ID")
export type ID = typeof ID.Type

export const ofBrain = (brainId: Brain.ID) => ID.make(`env_${Identifier.suffix(brainId)}`)

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
  egress: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))).annotate({
    description:
      "Whether the environment’s traffic goes through the egress, which replaces each ren:<LABEL> placeholder. Without it, a process gets no placeholders (R19).",
  }),
}).annotate({ identifier: "Environment.Access" })
