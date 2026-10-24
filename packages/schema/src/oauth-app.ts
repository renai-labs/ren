export * as OAuthApp from "./oauth-app.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("oap", "OAuthApp.ID")
export type ID = typeof ID.Type

export const TokenEndpointAuth = Schema.Literals(["none", "client_secret_basic", "client_secret_post"]).annotate({
  identifier: "OAuthApp.TokenEndpointAuth",
})
export type TokenEndpointAuth = typeof TokenEndpointAuth.Type

export const Discovery = Schema.Literals(["live", "static"]).annotate({
  identifier: "OAuthApp.Discovery",
  description: "`static` uses the stored endpoints and skips discovery.",
})
export type Discovery = typeof Discovery.Type
