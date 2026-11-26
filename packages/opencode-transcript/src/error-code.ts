export * as ErrorCode from "./error-code.js"

// oxlint-disable typescript/no-misused-spread -- schema types are plain readonly structs; Struct.assign would lose the caller's error type

import { SessionError } from "@ren/schema/session/error"
import { Option, Schema } from "effect"

// oxlint-disable-next-line ren/no-comments -- Providers §9.4: the gateway's refusal codes (`gate.py`, `seat.py`) in Ren's words.
const gateway: Readonly<Record<string, SessionError.Code>> = {
  insufficient_credits: "out_of_credits",
  free_limit_reached: "free_limit",
  provider_not_connected: "provider_not_connected",
  model_off: "model_off",
  subscription_limit_reached: "subscription_limit",
  seat_unavailable: "seat_unavailable",
  subscription_request_unsupported: "subscription_unsupported",
  inference_unavailable: "inference_unavailable",
  budget_unreadable: "inference_unavailable",
  entry_untagged: "model_unavailable",
  ren_upstream_unavailable: "upstream_unfunded",
  context_window_exceeded: "context_too_long",
}

// oxlint-disable-next-line ren/no-comments -- The gateway's refusal, `{ error: { code, retry?, resetsAt? } }`, which LiteLLM answers under `error.provider_specific_fields` on both of its routes.
const Refusal = Schema.Struct({
  code: Schema.String,
  retry: Schema.optionalKey(Schema.Boolean),
  resetsAt: Schema.optionalKey(Schema.String),
})
const decodeBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ error: Schema.Struct({ provider_specific_fields: Schema.Struct({ error: Refusal }) }) }),
  ),
)

const fromBody = (body: string | undefined) =>
  Option.map(decodeBody(body), (decoded) => decoded.error.provider_specific_fields.error)

const instant = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/u

// oxlint-disable-next-line ren/no-comments -- The `claude` program passes on only an error's message; the gateway ends it with its code and names the reset in it.
const fromMessage = (message: string): Option.Option<typeof Refusal.Type> =>
  Option.map(Option.fromNullishOr(/\(([a-z_]+)\)\s*$/u.exec(message)?.at(1)), (code) => {
    const resetsAt = instant.exec(message)?.at(0)
    return { code, ...(resetsAt && { resetsAt }) }
  })

// oxlint-disable-next-line ren/no-comments -- A vendor's own answer, for calls on an organization's key or subscription: what it says, then OpenCode's kind of error.
const byText: ReadonlyArray<{ readonly matches: RegExp; readonly code: SessionError.Code }> = [
  { matches: /budget[\s\S]*exceed|exceed[\s\S]*budget/iu, code: "out_of_credits" },
  { matches: /usage limit|weekly limit|plan limit/iu, code: "usage_limit" },
  {
    matches:
      /not supported when using .* account|not included in your plan|your plan does not|not available on your plan/iu,
    code: "plan_excluded",
  },
  { matches: /do not have access to it|does not have access to (the )?model/iu, code: "no_access" },
  { matches: /model_not_found|does not exist|no such model|model not found/iu, code: "model_unavailable" },
  { matches: /context length|context window|too long|maximum context/iu, code: "context_too_long" },
  { matches: /subscription[\s\S]*(inactive|expired|cancel|not active|payment)/iu, code: "subscription_inactive" },
]

const byKind: Readonly<Record<string, SessionError.Code>> = {
  "provider.free-limit": "plan_excluded",
  "provider.quota": "upstream_unfunded",
  "provider.rate-limit": "rate_limited",
  "provider.auth": "auth_lost",
  "provider.no-route": "model_unavailable",
  "provider.content-filter": "content_blocked",
  "provider.timeout": "upstream_down",
  "provider.transport": "upstream_down",
  "provider.internal": "upstream_down",
}

// oxlint-disable-next-line ren/no-comments -- A brain's own refusal names Ren's code at the end of its message (`BrainSettings.unavailable`).
const isCode = Schema.is(SessionError.Code)

// oxlint-disable-next-line ren/no-comments -- Final unless the gateway or the kind of error says the same call may work again.
const retryable = new Set<SessionError.Code>([
  "seat_unavailable",
  "inference_unavailable",
  "upstream_down",
  "rate_limited",
])

// oxlint-disable-next-line ren/no-comments -- Names what went wrong: the gateway's refusal first (its body, else the end of its message), then the vendor's answer. An error Ren cannot name keeps no code.
export const of = <E extends SessionError.Info>(error: E): E => {
  if (error.code) return error
  const refusal = Option.orElse(fromBody(error.response?.body), () => fromMessage(error.message))
  const named = Option.flatMap(refusal, (found) =>
    Option.map(Option.fromNullishOr(gateway[found.code] ?? (isCode(found.code) ? found.code : undefined)), (code) => ({
      ...found,
      code,
    })),
  )
  if (Option.isSome(named))
    return {
      ...error,
      code: named.value.code,
      retry: named.value.retry ?? retryable.has(named.value.code),
      ...(named.value.resetsAt && { resetsAt: named.value.resetsAt }),
    }
  const code =
    byText.find((rule) => rule.matches.test(error.message))?.code ??
    byKind[error.type] ??
    (error.type.startsWith("compaction.") ? "context_too_long" : undefined)
  return code ? { ...error, code, retry: retryable.has(code) } : error
}
