export * as OAuthSession from "./oauth-session.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("oas", "OAuthSession.ID")
export type ID = typeof ID.Type

export const Status = Schema.Literals(["pending", "complete", "failed", "expired"]).annotate({
  identifier: "OAuthSession.Status",
})
export type Status = typeof Status.Type
