export * as Mcp from "./mcp.js"

import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Primitive } from "./primitive.js"

const Remote = Schema.Struct({ type: Schema.Literal("remote"), url: Primitive.HttpsUrl })
const Local = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.NonEmptyArray(Schema.NonEmptyString),
  cwd: Schema.optionalKey(Schema.NonEmptyString),
  env: Schema.optionalKey(
    Schema.Record(Credential.EnvName, Schema.String).annotate({
      description:
        "Literal values, stored in the release and shown to every reader of it. Never a secret: a secret is a required credential.",
    }),
  ),
})
const Provider = Schema.Struct({
  type: Schema.Literal("provider"),
  provider: Credential.Provider,
  integration: Schema.NonEmptyString.annotate({
    description: "The provider’s name for the service, such as a Composio toolkit or a Pipedream app.",
  }),
})
const Managed = Schema.Struct({
  type: Schema.Literal("managed"),
  server: Primitive.Slug.annotate({ description: "The managed MCP of the integrations service that Ren calls." }),
  replaces: Schema.optionalKey(
    Primitive.Slug.annotate({
      description: "An MCP of the same app with auth. When a reached profile has its credential, this MCP is left out.",
    }),
  ),
}).annotate({ description: "An MCP that Ren runs on its own provider account, paid with Ren credits." })
export const Transport = Schema.Union([Remote, Local, Provider, Managed])
  .annotate({ identifier: "Mcp.Transport" })
  .pipe(Schema.toTaggedUnion("type"))
export type Transport = typeof Transport.Type

const NoAuth = Schema.Struct({ type: Schema.Literal("none") })
const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  authorizationEndpoint: Schema.optionalKey(Primitive.HttpsUrl).annotate({
    description: "Used only when discovery finds no authorization server metadata.",
  }),
  tokenEndpoint: Schema.optionalKey(Primitive.HttpsUrl).annotate({
    description: "Used only when discovery finds no authorization server metadata.",
  }),
  scopes: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)).annotate({
    description: "Asked for when neither the server’s challenge nor its metadata names scopes.",
  }),
  tokenEndpointAuth: Schema.Literals(["client_secret_basic", "client_secret_post", "none"]),
  client: Schema.optionalKey(
    Schema.Struct({
      clientId: Schema.NonEmptyString,
      resource: Schema.optionalKey(Primitive.HttpsUrl),
      redirectUri: Schema.optionalKey(Primitive.HttpsUrl),
    }).annotate({ description: "A partner’s OAuth client that Ren borrows, instead of registering its own." }),
  ),
})
const Header = Schema.Struct({
  type: Schema.Literal("header"),
  name: Schema.NonEmptyString,
  credential: Credential.Name,
})
const Basic = Schema.Struct({
  type: Schema.Literal("basic"),
  username: Credential.Name,
  password: Credential.Name,
})
export const Auth = Schema.Union([NoAuth, OAuth, Header, Basic]).annotate({ identifier: "Mcp.Auth" })
export type Auth = typeof Auth.Type

export interface Timeouts extends Schema.Schema.Type<typeof Timeouts> {}
export const Timeouts = Schema.Struct({
  startup: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  catalog: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  execution: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "Mcp.Timeouts", description: "Independent stage timeouts in milliseconds." })

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = Schema.Struct({
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  transport: Transport,
  auth: Auth,
  timeouts: Schema.optionalKey(Timeouts),
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
    Schema.makeFilter((mcp) =>
      mcp.transport.type === "managed" && mcp.auth.type !== "none"
        ? { path: ["auth"], issue: "A managed MCP has auth none." }
        : undefined,
    ),
  )
  .annotate({ identifier: "Mcp.Declaration" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ...Declaration.fields,
  transport: Schema.Union([Schema.Struct({ ...Remote.fields, url: Schema.String }), Local, Provider, Managed]),
  auth: Schema.Union([
    NoAuth,
    Schema.Struct({
      ...OAuth.fields,
      authorizationEndpoint: Schema.optionalKey(Schema.String),
      tokenEndpoint: Schema.optionalKey(Schema.String),
      client: Schema.optionalKey(
        Schema.Struct({
          clientId: Schema.NonEmptyString,
          resource: Schema.optionalKey(Schema.String),
          redirectUri: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
    Header,
    Basic,
  ]),
}).annotate({ identifier: "Mcp.Info" })
