export * as SessionError from "./error.js"

import { Schema } from "effect"

// oxlint-disable-next-line ren/no-comments -- Providers §9.4: what went wrong, in Ren's words. The harness adapter names it from the gateway's refusal or the vendor's answer; a client decides its card by this code alone.
export const Code = Schema.Literals([
  "out_of_credits",
  "free_limit",
  "provider_not_connected",
  "model_off",
  "model_unavailable",
  "subscription_limit",
  "seat_unavailable",
  "subscription_unsupported",
  "inference_unavailable",
  "upstream_unfunded",
  "upstream_down",
  "rate_limited",
  "usage_limit",
  "plan_excluded",
  "no_access",
  "subscription_inactive",
  "context_too_long",
  "auth_lost",
  "content_blocked",
]).annotate({ identifier: "SessionError.Code" })
export type Code = typeof Code.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))),
  response: Schema.optionalKey(Schema.Struct({ body: Schema.String })),
  code: Schema.optionalKey(Code),
  // oxlint-disable-next-line ren/no-comments -- False when trying the same call again cannot help before the person changes something.
  retry: Schema.optionalKey(Schema.Boolean),
  // oxlint-disable-next-line ren/no-comments -- When a limit lets calls through again (ISO 8601).
  resetsAt: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionError.Info" })
