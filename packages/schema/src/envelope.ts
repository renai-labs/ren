export * as Envelope from "./envelope.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"

export interface Sealed extends Schema.Schema.Type<typeof Sealed> {}
export const Sealed = Schema.Struct({
  v: Schema.Literal(1),
  keyId: Schema.NonEmptyString,
  wrappedKey: Schema.String,
  iv: Schema.String,
  ciphertext: Schema.String,
}).annotate({
  identifier: "Envelope.Sealed",
  description: "A secret encrypted with a random data key; the data key is wrapped with the master key `keyId`.",
})

export interface Context extends Schema.Schema.Type<typeof Context> {}
export const Context = Schema.Struct({
  organizationId: Auth.OrganizationID,
  kind: Schema.Literals(["credential", "oauth_app", "oauth_session", "credential_caller", "channel_install"]),
  id: Schema.String,
}).annotate({
  identifier: "Envelope.Context",
  description: "Bound to the ciphertext, so a sealed value cannot move to another row.",
})
