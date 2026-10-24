export * as OAuthApp from "./oauth-app.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

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

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  name: Schema.String.annotate({ description: "The name an MCP’s `oauth_app` requirement asks for." }),
  clientId: Schema.String,
  hasClientSecret: Schema.Boolean,
  scopes: Schema.Array(Schema.String),
  discovery: Discovery,
  authorizationEndpoint: Schema.NullOr(Schema.String),
  tokenEndpoint: Schema.NullOr(Schema.String),
  tokenEndpointAuth: TokenEndpointAuth,
  resource: Schema.NullOr(Schema.String),
  authorizeParams: Schema.Record(Schema.String, Schema.String),
  configuredBy: Schema.NullOr(Auth.UserID),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "OAuthApp.Info", description: "An org’s own OAuth client. Ren never returns its secret." })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({ ...Pagination.fields(50) }).annotate({ identifier: "OAuthApp.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "OAuthApp.Page" })

const fields = {
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.optional(Schema.RedactedFromValue(Schema.NonEmptyString)),
  scopes: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  discovery: Schema.optional(Discovery),
  authorizationEndpoint: Schema.optional(Primitive.HttpsUrl),
  tokenEndpoint: Schema.optional(Primitive.HttpsUrl),
  tokenEndpointAuth: Schema.optional(TokenEndpointAuth),
  resource: Schema.optional(Primitive.HttpsUrl),
  authorizeParams: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({ name: Primitive.Name, ...fields })
  .check(
    Schema.makeFilter(
      (input) =>
        input.discovery !== "static" ||
        Boolean(input.authorizationEndpoint && input.tokenEndpoint) ||
        "A static app needs its authorization and token endpoints.",
    ),
  )
  .annotate({ identifier: "OAuthApp.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Primitive.Name),
  ...fields,
  clientId: Schema.optional(Schema.NonEmptyString),
}).annotate({ identifier: "OAuthApp.UpdateInput" })

export const definition = Primitive.define({
  name: "oauth-app",
  plural: "oauth-apps",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})
