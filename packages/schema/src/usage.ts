export * as Usage from "./usage.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Brain } from "./brain.js"
import { Space } from "./space.js"

export const Type = Schema.Literals(["model.call"]).annotate({ identifier: "Usage.Type" })
export type Type = typeof Type.Type

export const Quantity = Schema.Literals([
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cache_write_1h_tokens",
]).annotate({ identifier: "Usage.Quantity" })
export type Quantity = typeof Quantity.Type

export const meters: Record<Type, ReadonlyArray<Quantity>> = {
  "model.call": Quantity.literals,
}

// oxlint-disable-next-line ren/no-comments -- Why a harness made a model request. Each harness maps its own kinds to these.
export const Kind = Schema.Literals(["primary", "compaction", "title", "generate"]).annotate({
  identifier: "Usage.Kind",
})
export type Kind = typeof Kind.Type

export const Payer = Schema.Literals(["ren", "customer"]).annotate({ identifier: "Usage.Payer" })
export type Payer = typeof Payer.Type

// oxlint-disable-next-line ren/no-comments -- The headers that a brain adds to each request to a Ren model. They are claims that Ren checks after it stores the event (usage spec §4.3). They have no x-ren- prefix, because the egress removes x-ren-* headers.
export const headers = {
  rootSession: "ren-root-session",
  session: "ren-session",
  turn: "ren-turn",
  agent: "ren-agent",
  kind: "ren-request-kind",
  variant: "ren-model-variant",
} as const

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// oxlint-disable-next-line ren/no-comments -- A claim from the brain, stored as sent. It is a plain string so that a wrong claim never refuses the batch (§1.3).
const Claim = Schema.optionalKey(Schema.String)

export interface Failure extends Schema.Schema.Type<typeof Failure> {}
export const Failure = Schema.Struct({
  status: Schema.optionalKey(Schema.Int),
  message: Schema.String,
}).annotate({ identifier: "Usage.Failure" })

export interface Event extends Schema.Schema.Type<typeof Event> {}
export const Event = Schema.Struct({
  source: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  type: Type,
  time: Schema.DateTimeUtc,
  workload: Schema.String.annotate({ description: "`brain:<id>` or `hand:<id>`, then `:<generation>` when known." }),
  organization: Auth.OrganizationID.annotate({ description: "From the workload’s key. Ren stores it as sent." }),
  brain: Schema.optionalKey(Brain.ID).annotate({ description: "From the workload’s key. Ren stores it as sent." }),
  space: Schema.optionalKey(Space.ID).annotate({ description: "From the workload’s key. Ren checks it later." }),
  root_session: Claim,
  session: Claim,
  turn: Claim,
  member: Claim,
  agent: Claim,
  kind: Claim,
  requested_model: Schema.String,
  variant: Claim,
  payer: Payer,
  provider: Schema.String,
  served_model: Schema.String,
  input_tokens: Schema.optionalKey(Count),
  output_tokens: Schema.optionalKey(Count),
  reasoning_tokens: Schema.optionalKey(Count),
  cache_read_tokens: Schema.optionalKey(Count),
  cache_write_tokens: Schema.optionalKey(Count),
  cache_write_1h_tokens: Schema.optionalKey(Count),
  cost_micro_usd: Schema.optionalKey(Schema.NullOr(Count)),
  latency_ms: Schema.optionalKey(Count),
  time_to_first_token_ms: Schema.optionalKey(Count),
  stop_reason: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Failure),
}).annotate({ identifier: "Usage.Event" })

export interface Batch extends Schema.Schema.Type<typeof Batch> {}
export const Batch = Schema.Struct({
  events: Schema.Array(Event).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
}).annotate({ identifier: "Usage.Batch" })

export interface Recorded extends Schema.Schema.Type<typeof Recorded> {}
export const Recorded = Schema.Struct({
  inserted: Count,
}).annotate({ identifier: "Usage.Recorded" })
