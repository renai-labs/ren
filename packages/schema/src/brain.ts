export * as Brain from "./brain.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import { Models } from "./models.js"
import type { Session } from "./session.js"

export const ID = Identifier.make("brn", "Brain.ID")
export type ID = typeof ID.Type

export const ofSession = (sessionId: Session.ID) => ID.make(`brn_${Identifier.suffix(sessionId)}`)

export const Scope = Schema.Literals(["session", "space"]).annotate({ identifier: "Brain.Scope" })
export type Scope = typeof Scope.Type

export const Phase = Schema.Literals([
  "creating",
  "booting",
  "resuming",
  "waking",
  "replacing",
  "ready",
  "failed",
  "capacity",
]).annotate({ identifier: "Brain.Phase" })
export type Phase = typeof Phase.Type

export interface ModelGrant extends Schema.Schema.Type<typeof ModelGrant> {}
export const ModelGrant = Schema.Struct({
  access: Models.Access,
  hostToken: Schema.optionalKey(Schema.Redacted(Schema.NonEmptyString)),
}).annotate({ identifier: "Brain.ModelGrant" })
