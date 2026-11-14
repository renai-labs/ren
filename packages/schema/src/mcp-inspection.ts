export * as McpInspection from "./mcp-inspection.js"

import { Schema } from "effect"
import { AppListing } from "./app-listing.js"
import { Primitive } from "./primitive.js"

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  url: Primitive.HttpsUrl.annotate({ description: "The MCP server’s streamable HTTP address." }),
}).annotate({ identifier: "McpInspection.Input" })

export interface Server extends Schema.Schema.Type<typeof Server> {}
export const Server = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  websiteUrl: Schema.optionalKey(Schema.String),
}).annotate({
  identifier: "McpInspection.Server",
  description: "What the server says about itself, in its initialize answer or its server card.",
})

export const Client = Schema.Literals(["metadata-document", "registration", "oauth-app"]).annotate({
  identifier: "McpInspection.Client",
  description:
    "How Ren gets an OAuth client: its client metadata document, dynamic registration, or an org OAuth app when the server allows neither.",
})
export type Client = typeof Client.Type

export const Auth = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({ type: Schema.Literal("oauth"), scopes: Schema.Array(Schema.String), client: Client }),
  Schema.Struct({ type: Schema.Literals(["bearer", "basic", "unknown"]) }),
]).annotate({
  identifier: "McpInspection.Auth",
  description: "The auth the server asks for: none, a sign-in, a token, a user name and password, or unknown.",
})
export type Auth = typeof Auth.Type

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  reachable: Schema.Boolean,
  server: Schema.NullOr(Server),
  auth: Auth,
  tools: Schema.NullOr(Schema.Array(AppListing.Tool)).annotate({
    description: "Sorted by name. Null when the server lists its tools only after a sign-in.",
  }),
  source: Schema.NullOr(Schema.Literals(["tools-list", "server-card"])),
  problem: Schema.NullOr(Schema.String).annotate({ description: "Why Ren could not read the server." }),
}).annotate({ identifier: "McpInspection.Result" })
