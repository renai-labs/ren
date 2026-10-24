export * as Injection from "./injection.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"

export const OpName = Schema.Literals(["replace", "setHeader", "route"]).annotate({ identifier: "Injection.OpName" })
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
  Schema.Struct({ op: Schema.Literal("route"), upstream: Schema.Redacted(Schema.String) }),
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
]).annotate({ identifier: "Injection.DenyReason" })
export type DenyReason = typeof DenyReason.Type

export const Reply = Schema.Union([
  Schema.Struct({
    allow: Schema.Literal(true),
    workload: Schema.String,
    ttl: Schema.Int,
    labels: Schema.Array(Schema.String).annotate({
      description: "The labels the answer used, so Ren can tell the egress to drop it when one of them changes.",
    }),
    inject: Schema.Array(Op),
  }),
  Schema.Struct({
    allow: Schema.Literal(false),
    reason: DenyReason,
    label: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "Injection.Reply" })
export type Reply = typeof Reply.Type
