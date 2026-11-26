import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { Translate } from "../src/translate.js"

const limit =
  "All anthropic subscriptions of the organization that serve claude-haiku-5-5 are at their limit. The first is free again at 2026-11-26T15:24:13.687Z. (subscription_limit_reached)"

const failed = (error: Record<string, unknown>) =>
  Option.map(
    Translate.event({ id: "evt_1", created: 1, type: "session.execution.failed", data: { sessionID: "ses_1", error } }),
    (event) => ("error" in event.data ? event.data.error : undefined),
  )

describe("a model error reaches the chat with Ren's code (providers §9.4)", () => {
  test("the gateway's refusal names the code, whether to retry and the reset, from the body on the chat completions route", () => {
    const body = JSON.stringify({
      error: {
        message: limit,
        code: "429",
        provider_specific_fields: {
          error: { code: "subscription_limit_reached", retry: false, resetsAt: "2026-11-26T15:24:13.687Z" },
        },
      },
    })
    expect(failed({ type: "provider.rate-limit", message: "Rate limited", status: 429, response: { body } })).toEqual(
      Option.some({
        type: "provider.rate-limit",
        message: "Rate limited",
        status: 429,
        response: { body },
        code: "subscription_limit",
        retry: false,
        resetsAt: "2026-11-26T15:24:13.687Z",
      }),
    )
  })

  test("the claude program passes on only the message: its last words name the code and the reset", () => {
    expect(failed({ type: "provider.rate-limit", message: limit })).toEqual(
      Option.some({
        type: "provider.rate-limit",
        message: limit,
        code: "subscription_limit",
        retry: false,
        resetsAt: "2026-11-26T15:24:13.687Z",
      }),
    )
  })

  test("the claude program wraps the gateway's answer in its own words; the code inside still names it", () => {
    const wrapped = `API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"${limit}"}}`
    expect(Option.map(failed({ type: "unknown", message: wrapped }), (error) => error?.code)).toEqual(
      Option.some("subscription_limit"),
    )
  })

  test("a refusal that may pass on another try says so", () => {
    const error = failed({
      type: "provider.internal",
      message: "Inference is temporarily unavailable. (inference_unavailable)",
    })
    expect(Option.map(error, (found) => [found?.code, found?.retry])).toEqual(
      Option.some(["inference_unavailable", true]),
    )
  })

  test("a vendor's own answer is named by what it says, else by its kind", () => {
    const code = (type: string, message: string) => Option.map(failed({ type, message }), (error) => error?.code)
    expect(code("provider.rate-limit", "You have hit your usage limit. It resets in 3 hours.")).toEqual(
      Option.some("usage_limit"),
    )
    expect(code("provider.invalid", "prompt is too long: 210000 tokens > 200000 maximum")).toEqual(
      Option.some("context_too_long"),
    )
    expect(code("provider.auth", "invalid x-api-key")).toEqual(Option.some("auth_lost"))
    expect(code("provider.transport", "socket hang up")).toEqual(Option.some("upstream_down"))
    expect(code("compaction.failed", "the summary did not fit")).toEqual(Option.some("context_too_long"))
    expect(code("unknown", "something else")).toEqual(Option.some(undefined))
  })
})
