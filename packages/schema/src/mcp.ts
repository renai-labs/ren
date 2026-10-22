export * as Mcp from "./mcp.js"

import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Primitive } from "./primitive.js"

export const Transport = Schema.Union([
  Schema.Struct({ type: Schema.Literal("remote"), url: Primitive.HttpsUrl }),
  Schema.Struct({ type: Schema.Literal("local"), command: Schema.NonEmptyArray(Schema.NonEmptyString) }),
  Schema.Struct({
    type: Schema.Literal("provider"),
    provider: Schema.Literals(["composio"]),
    toolkit: Schema.NonEmptyString.annotate({
      description: "The provider’s toolkit. Ren looks up the provider’s auth config for each environment.",
    }),
  }),
]).annotate({ identifier: "Mcp.Transport" })
export type Transport = typeof Transport.Type

export const Auth = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    authorizationEndpoint: Primitive.HttpsUrl,
    tokenEndpoint: Primitive.HttpsUrl,
    tokenEndpointAuth: Schema.Literals(["client_secret_basic", "client_secret_post", "none"]),
    client: Schema.optionalKey(
      Schema.Struct({
        clientId: Schema.NonEmptyString,
        resource: Schema.optionalKey(Primitive.HttpsUrl),
        redirectUri: Schema.optionalKey(Primitive.HttpsUrl),
      }).annotate({ description: "A partner’s OAuth client that Ren borrows, instead of registering its own." }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("header"),
    name: Schema.NonEmptyString,
    credential: Credential.Name,
  }),
  Schema.Struct({
    type: Schema.Literal("basic"),
    username: Credential.Name,
    password: Credential.Name,
  }),
]).annotate({ identifier: "Mcp.Auth" })
export type Auth = typeof Auth.Type

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = Schema.Struct({
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  transport: Transport,
  auth: Auth,
  requiredCredentials: Schema.Array(Credential.Requirement).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
})
  .check(
    Schema.makeFilter((mcp) => {
      const auth = mcp.auth
      return [
        ...(auth.type === "header" ? [auth.credential] : []),
        ...(auth.type === "basic" ? [auth.username, auth.password] : []),
      ]
        .filter((name) => !mcp.requiredCredentials.some((requirement) => requirement.name === name))
        .map((name) => ({
          path: ["auth"],
          issue: `The auth uses credential "${name}", which the MCP does not require.`,
        }))
    }),
  )
  .annotate({ identifier: "Mcp.Declaration" })
