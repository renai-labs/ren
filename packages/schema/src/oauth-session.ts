export * as OAuthSession from "./oauth-session.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"
import { Identifier } from "./identifier.js"
import { Primitive } from "./primitive.js"

export const ID = Identifier.make("oas", "OAuthSession.ID")
export type ID = typeof ID.Type

export const Status = Schema.Literals(["pending", "complete", "failed", "expired"]).annotate({
  identifier: "OAuthSession.Status",
})
export type Status = typeof Status.Type

export const lifetimeMinutes = 10

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  status: Status,
  label: Schema.String,
  credentialId: Schema.NullOr(Credential.ID).annotate({ description: "The credential, once the sign-in completed." }),
  failureReason: Schema.NullOr(Schema.String),
  sameAccountAs: Schema.NullOr(Schema.String).annotate({
    description: "The display name of another connection that holds the same account (K41).",
  }),
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "OAuthSession.Info" })

export interface CompleteInput extends Schema.Schema.Type<typeof CompleteInput> {}
export const CompleteInput = Schema.Struct({
  callbackUrl: Schema.String.check(Schema.isMaxLength(4096)),
}).annotate({
  identifier: "OAuthSession.CompleteInput",
  description: "The address the person landed on, for a client that returns to 127.0.0.1. Not built yet.",
})

export const definition = Primitive.define({
  name: "oauth-session",
  plural: "oauth-sessions",
  id: ID,
  info: Info,
  get: true,
})
