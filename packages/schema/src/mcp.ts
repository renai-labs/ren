export * as Mcp from "./mcp.js"

import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Primitive } from "./primitive.js"

export const Transport = Schema.Union([
  Schema.Struct({ type: Schema.Literal("remote"), url: Primitive.HttpsUrl }),
  Schema.Struct({ type: Schema.Literal("local"), command: Schema.NonEmptyArray(Schema.NonEmptyString) }),
]).annotate({ identifier: "Mcp.Transport" })
export type Transport = typeof Transport.Type

export const Auth = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    authorizationEndpoint: Primitive.HttpsUrl,
    tokenEndpoint: Primitive.HttpsUrl,
    tokenEndpointAuth: Schema.Literals(["client_secret_basic", "client_secret_post", "none"]),
  }),
  Schema.Struct({
    type: Schema.Literal("header"),
    name: Schema.NonEmptyString,
    credential: Credential.FieldName,
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
  tools: Schema.optionalKey(
    Schema.Array(Schema.NonEmptyString).annotate({ description: "Without it, every tool that the server lists." }),
  ),
})
  .check(
    Schema.makeFilter((mcp) => {
      const auth = mcp.auth
      return (
        auth.type !== "header" ||
        mcp.requiredCredentials.some((requirement) => requirement.name === auth.credential) || {
          path: ["auth", "credential"],
          issue: `The header uses credential "${auth.credential}", which the MCP does not require.`,
        }
      )
    }),
  )
  .annotate({ identifier: "Mcp.Declaration" })
