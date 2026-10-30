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
  operation: Schema.optionalKey(Schema.String).annotate({
    description: "The gateway’s call type, such as completion, image_generation, speech, transcription or decisions.",
  }),
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
  usage: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)).annotate({
    description:
      "The usage the provider reported, as it sent it: tokens, seconds, images or characters. Ren does not read it.",
  }),
}).annotate({ identifier: "Usage.ModelCall" })

const fields = {
  source: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
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
}

export interface ModelCallEvent extends Schema.Schema.Type<typeof ModelCallEvent> {}
export const ModelCallEvent = Schema.Struct({
  ...fields,
  type: Schema.Literal("model.call"),
  data: ModelCall,
}).annotate({ identifier: "Usage.ModelCallEvent" })

export interface SandboxCompute extends Schema.Schema.Type<typeof SandboxCompute> {}
export const SandboxCompute = Schema.Struct({
  sandbox_id: Schema.NonEmptyString,
  duration_ms: Count,
  vcpu_ms: Count.annotate({ description: "vCPUs × milliseconds." }),
  memory_mib_ms: Count.annotate({ description: "MiB of memory × milliseconds." }),
}).annotate({ identifier: "Usage.SandboxCompute" })

export interface SandboxComputeEvent extends Schema.Schema.Type<typeof SandboxComputeEvent> {}
export const SandboxComputeEvent = Schema.Struct({
  ...fields,
  type: Schema.Literal("sandbox.compute"),
  data: SandboxCompute,
}).annotate({ identifier: "Usage.SandboxComputeEvent" })

export interface ApiCall extends Schema.Schema.Type<typeof ApiCall> {}
export const ApiCall = Schema.Struct({
  mcp: Schema.NonEmptyString.annotate({ description: "The MCP slug that the call went through." }),
  tool: Schema.optionalKey(Schema.String),
  upstream: Schema.optionalKey(Schema.String).annotate({ description: "The provider’s API or product that it used." }),
  units: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)).annotate({
    description: "What the provider counted, as it sent it: milliseconds, requests or results. Ren does not read it.",
  }),
  latency_ms: Schema.optionalKey(Count),
}).annotate({ identifier: "Usage.ApiCall" })

export interface ApiCallEvent extends Schema.Schema.Type<typeof ApiCallEvent> {}
export const ApiCallEvent = Schema.Struct({
  ...fields,
  type: Schema.Literal("api.call"),
  data: ApiCall,
}).annotate({ identifier: "Usage.ApiCallEvent" })

export type Event = ModelCallEvent | SandboxComputeEvent | ApiCallEvent

export interface Batch extends Schema.Schema.Type<typeof Batch> {}
export const Batch = Schema.Struct({
  events: Schema.Array(Schema.Union([ModelCallEvent, ApiCallEvent])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
}).annotate({ identifier: "Usage.Batch" })

export interface Recorded extends Schema.Schema.Type<typeof Recorded> {}
export const Recorded = Schema.Struct({
  inserted: Count,
}).annotate({ identifier: "Usage.Recorded" })
