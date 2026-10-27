export * as Injection from "./injection.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"

export const OpName = Schema.Literals(["replace", "setHeader", "route", "awsSign"]).annotate({
  identifier: "Injection.OpName",
})
export type OpName = typeof OpName.Type

export const opNames: ReadonlyArray<OpName> = OpName.literals

export const Op = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("replace"),
    placeholder: Schema.String,
    value: Schema.Redacted(Schema.String),
    in: Schema.NonEmptyArray(Credential.Location),
  }),
  Schema.Struct({ op: Schema.Literal("setHeader"), name: Schema.String, value: Schema.Redacted(Schema.String) }),
  Schema.Struct({
    op: Schema.Literal("route"),
    upstream: Schema.Redacted(Schema.String),
    placeholder: Schema.optional(Schema.String).annotate({
      description:
        "The first path segment, such as `ren:MCP_GMAIL`, that the egress removes before it appends the rest of the path to the upstream.",
    }),
  }),
  Schema.Struct({
    op: Schema.Literal("awsSign"),
    accessKeyId: Schema.String,
    secretAccessKey: Schema.Redacted(Schema.String),
    sessionToken: Schema.Redacted(Schema.String),
  }).annotate({
    description:
      "The egress removes the request’s AWS SigV4 signature, which holds a placeholder, and signs it again with these keys, for the region and service of the removed signature.",
  }),
]).annotate({
  identifier: "Injection.Op",
  description: "One change the egress makes to a request. The egress knows no credential type, only these ops.",
})
export type Op = typeof Op.Type

export const DenyReason = Schema.Literals([
  "unknown_workload",
  "generation_retired",
  "host_not_allowed",
  "credential_missing",
  "ambiguous",
  "principal_scope",
  "egress_outdated",
  "credential_reconnect",
]).annotate({ identifier: "Injection.DenyReason" })
export type DenyReason = typeof DenyReason.Type

export const Reply = Schema.Union([
  Schema.Struct({
    allow: Schema.Literal(true),
    workload: Schema.String,
    ttl: Schema.Int,
    expiresAt: Schema.optional(Schema.Int).annotate({
      description:
        "Unix seconds when the first value in the answer stops working. The egress never uses the answer after it, also when Ren does not answer.",
    }),
    labels: Schema.Array(Schema.String).annotate({
      description: "The labels the answer used, so Ren can tell the egress to drop it when one of them changes.",
    }),
    inject: Schema.Array(Op),
    refreshable: Schema.Array(Schema.Struct({ label: Schema.String, revision: Schema.Int })).annotate({
      description:
        "The labels in this answer that Ren can renew, with the revision it injected. After an upstream 401 the egress reports them.",
    }),
  }),
  Schema.Struct({
    allow: Schema.Literal(false),
    reason: DenyReason,
    label: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "Injection.Reply" })
export type Reply = typeof Reply.Type
