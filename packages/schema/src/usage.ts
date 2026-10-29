export * as Usage from "./usage.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Brain } from "./brain.js"
import { Space } from "./space.js"

export const Kind = Schema.Literals(["primary", "compaction", "title", "generate"]).annotate({
  identifier: "Usage.Kind",
})
export type Kind = typeof Kind.Type

export const Payer = Schema.Literals(["ren", "customer"]).annotate({ identifier: "Usage.Payer" })
export type Payer = typeof Payer.Type

export const headers = {
  rootSession: "ren-root-session",
  session: "ren-session",
  turn: "ren-turn",
  agent: "ren-agent",
  kind: "ren-request-kind",
  variant: "ren-model-variant",
} as const

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const Claim = Schema.optionalKey(Schema.String)

export interface Failure extends Schema.Schema.Type<typeof Failure> {}
export const Failure = Schema.Struct({
  status: Schema.optionalKey(Schema.Int),
  message: Schema.String,
}).annotate({ identifier: "Usage.Failure" })

export interface ModelCall extends Schema.Schema.Type<typeof ModelCall> {}
export const ModelCall = Schema.Struct({
  requested_model: Schema.String,
  served_model: Schema.String,
  kind: Claim,
  variant: Claim,
  input_tokens: Schema.optionalKey(Count),
  output_tokens: Schema.optionalKey(Count),
  reasoning_tokens: Schema.optionalKey(Count),
  cache_read_tokens: Schema.optionalKey(Count),
  cache_write_tokens: Schema.optionalKey(Count),
  cache_write_1h_tokens: Schema.optionalKey(Count),
  latency_ms: Schema.optionalKey(Count),
  time_to_first_token_ms: Schema.optionalKey(Count),
  stop_reason: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Usage.ModelCall" })

export interface Event extends Schema.Schema.Type<typeof Event> {}
export const Event = Schema.Struct({
  source: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  type: Schema.Literal("model.call"),
  time: Schema.DateTimeUtc,
  workload: Schema.String.annotate({ description: "`brain:<id>` or `hand:<id>`, then `:<generation>` when known." }),
  organization: Auth.OrganizationID.annotate({ description: "From the workload’s key. Ren stores it as sent." }),
  brain: Schema.optionalKey(Brain.ID).annotate({ description: "From the workload’s key. Ren stores it as sent." }),
  space: Schema.optionalKey(Space.ID).annotate({ description: "From the workload’s key. Ren stores it as sent." }),
  root_session: Claim,
  session: Claim,
  turn: Claim,
  member: Claim,
  agent: Claim,
  payer: Payer,
  provider: Schema.String,
  cost_micro_usd: Schema.optionalKey(Count),
  error: Schema.optionalKey(Failure),
  data: ModelCall,
}).annotate({ identifier: "Usage.Event" })

export interface Batch extends Schema.Schema.Type<typeof Batch> {}
export const Batch = Schema.Struct({
  events: Schema.Array(Event).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
}).annotate({ identifier: "Usage.Batch" })

export interface Recorded extends Schema.Schema.Type<typeof Recorded> {}
export const Recorded = Schema.Struct({
  inserted: Count,
}).annotate({ identifier: "Usage.Recorded" })
