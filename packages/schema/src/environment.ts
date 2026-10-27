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
  sharedDirectory: Schema.optionalKey(Directory).annotate({
    description:
      "The folder that every session on the environment shares, such as the copies of references (R49). Without it, `.ren` beside the session folders.",
  }),
}).annotate({ identifier: "Environment.Access" })

// oxlint-disable-next-line ren/no-comments -- R49: an older server sends no sharedDirectory; its sessions sit in one folder, so .ren beside them is shared.
export const sharedDirectoryOf = (access: Pick<Access, "directory" | "sharedDirectory">) =>
  access.sharedDirectory ?? `${access.directory.slice(0, access.directory.lastIndexOf("/")) || ""}/.ren`
