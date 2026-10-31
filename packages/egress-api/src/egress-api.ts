export * as EgressApi from "./egress-api.js"

import { Credential } from "@ren/schema/credential"
import { Injection } from "@ren/schema/injection"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

export const Proof = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("ProxyLogin"),
    username: Schema.String,
    password: Schema.RedactedFromValue(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("Login"), username: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("Token"), token: Schema.String }),
]).annotate({
  identifier: "Egress.Proof",
  description:
    "Which workload sent a connection. `Login` names a proxy login that the egress checked with `ProxyLogin` when the connection opened.",
})

export interface AuthenticateRequest extends Schema.Schema.Type<typeof AuthenticateRequest> {}
export const AuthenticateRequest = Schema.Struct({
  proof: Proof,
  remoteAddr: Schema.optional(Schema.String),
}).annotate({ identifier: "Egress.AuthenticateRequest" })

export const AuthenticateReply = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), workload: Schema.String }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.Literals(["unknown_workload", "generation_retired", "principal_scope"]),
  }),
]).annotate({ identifier: "Egress.AuthenticateReply" })

export interface ResolveRequest extends Schema.Schema.Type<typeof ResolveRequest> {}
export const ResolveRequest = Schema.Struct({
  proof: Proof,
  host: Schema.String.annotate({ description: "The host the egress dials." }),
  port: Schema.Int,
  method: Schema.String,
  path: Schema.String,
  placeholders: Schema.Array(Schema.String).annotate({ description: "The ren:<LABEL> placeholders in the request." }),
  ops: Schema.Array(Injection.OpName).annotate({ description: "The ops this egress carries out (C41)." }),
}).annotate({ identifier: "Egress.ResolveRequest" })

const WireOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("replace"),
    placeholder: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
    in: Schema.NonEmptyArray(Credential.Location),
  }),
  Schema.Struct({
    op: Schema.Literal("setHeader"),
    name: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("route"),
    upstream: Schema.RedactedFromValue(Schema.String),
    placeholder: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("awsSign"),
    accessKeyId: Schema.String,
    secretAccessKey: Schema.RedactedFromValue(Schema.String),
    sessionToken: Schema.RedactedFromValue(Schema.String),
  }),
]).annotate({ identifier: "Egress.Op" })

const Refreshable = Schema.Struct({ label: Schema.String, revision: Schema.Int })

export const ResolveReply = Schema.Union([
  Schema.Struct({
    allow: Schema.Literal(true),
    workload: Schema.String,
    ttl: Schema.Int,
    expiresAt: Schema.optional(Schema.Int),
    labels: Schema.Array(Schema.String),
    inject: Schema.Array(WireOp),
    refreshable: Schema.Array(Refreshable).annotate({
      description: "Labels that Ren can renew, with the revision it injected. The egress reports them after a 401.",
    }),
  }),
  Schema.Struct({
    allow: Schema.Literal(false),
    reason: Injection.DenyReason,
    label: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "Egress.ResolveReply" })

export interface UnauthorizedRequest extends Schema.Schema.Type<typeof UnauthorizedRequest> {}
export const UnauthorizedRequest = Schema.Struct({
  login: Schema.String.annotate({ description: "The proxy login of the connection that sent the request." }),
  host: Schema.String,
  status: Schema.Literals([401, 403]),
  scope: Schema.optionalKey(Schema.String).annotate({
    description: "The `scope` of a 403 `insufficient_scope` challenge.",
  }),
  labels: Schema.Array(Refreshable),
}).annotate({ identifier: "Egress.UnauthorizedRequest" })

const EgressGroup = HttpApiGroup.make("egress")
  .add(
    HttpApiEndpoint.post("authenticate", "/egress/v1/authenticate", {
      payload: AuthenticateRequest,
      success: AuthenticateReply,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "egress.authenticate",
        summary: "Check a proxy login",
        description: "The egress calls this once for each new connection with a proxy login.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("resolve", "/egress/v1/resolve", {
      payload: ResolveRequest,
      success: ResolveReply,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "egress.resolve",
        summary: "Say what a request gets",
        description:
          "Ren answers with the ops that put credentials into the request, or with a denial that names the reason and the label. Values in the answer are secrets.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("unauthorized", "/egress/v1/unauthorized", {
      payload: UnauthorizedRequest,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "egress.unauthorized",
        summary: "Report an upstream 401",
        description:
          "The egress calls this after an upstream answered 401, or 403 with insufficient_scope, to a request with refreshable labels. Ren answers 204 at once and renews in the background; the egress never waits for it.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "egress" }))

export const Api = HttpApi.make("egress")
  .add(EgressGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Egress API",
      version: "0.0.0",
      description:
        "Internal API an egress proxy calls to learn which workload sent a connection and which credentials a request gets. Ren’s own egress authenticates with mTLS.",
    }),
  )
