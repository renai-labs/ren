import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { TurnProblems } from "../src/turn-problems.js"

const at = (millis: number) => DateTime.makeUnsafe(millis)

const assistant = (providerID: string, id: string): SessionMessage.Assistant => ({
  id: SessionMessage.ID.make("msg_assistant"),
  type: "assistant",
  agent: "build",
  model: { id, providerID },
  content: [],
  time: { created: at(2), completed: at(3) },
})

const refused = (input: {
  readonly kind: string
  readonly code: string
  readonly admin: boolean
  readonly providerID?: string
  readonly model?: string
}) =>
  TurnProblems.of({
    kind: input.kind,
    text: "Refused.",
    body: JSON.stringify({ error: { code: input.code, message: "Refused." } }),
    assistants: [assistant(input.providerID ?? "anthropic", input.model ?? "claude-opus-5-5")],
    modelNames: new Map([
      ["claude-opus-5-5", "Claude Opus 5.5"],
      ["gemma-4-31b-it:free", "Gemma 4 31B"],
    ]),
    providerNames: new Map([
      ["anthropic", "Anthropic"],
      ["groq", "Groq"],
    ]),
    admin: input.admin,
  })

describe("TurnProblems.of", () => {
  test("the inference service's code in the response body decides the text and the actions", () => {
    const shown = (input: Parameters<typeof refused>[0]) => {
      const problem = refused(input)
      return { title: problem.title, fix: problem.fix, actions: problem.actions }
    }
    expect(shown({ kind: "provider.quota", code: "insufficient_credits", admin: true })).toEqual({
      title: "You’re out of Ren credits.",
      fix: "Add credits, or connect a provider of your own in Providers. Then try again.",
      actions: ["billing", "model", "providers"],
    })
    expect(shown({ kind: "provider.quota", code: "insufficient_credits", admin: false }).actions).toEqual(["model"])
    expect(shown({ kind: "provider.rate-limit", code: "free_limit_reached", admin: true, providerID: "ren" })).toEqual({
      title: "Free models: today’s 100 requests are used.",
      fix: "They reset at 00:00 UTC.",
      actions: ["model"],
    })
    expect(
      shown({ kind: "provider.auth", code: "provider_not_connected", admin: true, providerID: "groq", model: "llama" }),
    ).toEqual({
      title: "Groq is not connected.",
      fix: "Connect it in Providers, or pick another model.",
      actions: ["providers", "model"],
    })
    expect(
      shown({
        kind: "provider.auth",
        code: "provider_not_connected",
        admin: false,
        providerID: "groq",
        model: "llama",
      }),
    ).toEqual({
      title: "Groq is not connected.",
      fix: "Ask an admin to connect it, or pick another model.",
      actions: ["model"],
    })
    expect(shown({ kind: "provider.auth", code: "model_off", admin: true })).toEqual({
      title: "Claude Opus 5.5 is switched off for this organization.",
      fix: "Switch it on in Providers, or pick another model.",
      actions: ["providers", "model"],
    })
    expect(shown({ kind: "provider.auth", code: "model_off", admin: false }).actions).toEqual(["model"])
    expect(shown({ kind: "provider.rate-limit", code: "subscription_limit_reached", admin: true })).toEqual({
      title: "All Anthropic subscriptions are at their limit.",
      fix: "The next resets soon. Pick another model to keep going.",
      actions: ["model"],
    })
    expect(shown({ kind: "provider.internal", code: "inference_unavailable", admin: true })).toEqual({
      title: "Model access is not available now.",
      fix: "Try again.",
      actions: ["try"],
    })
    expect(shown({ kind: "provider.rate-limit", code: "seat_unavailable", admin: true })).toEqual({
      title: "No Anthropic subscription can serve this now.",
      fix: "Try again, or pick another model.",
      actions: ["try", "model"],
    })
    expect(shown({ kind: "provider.invalid", code: "subscription_request_unsupported", admin: true })).toEqual({
      title: "Anthropic subscriptions can’t serve this request.",
      fix: "Pick another model to keep going.",
      actions: ["model"],
    })
  })

  test("the next reset of a subscription limit comes from the inference service's answer", () => {
    const problem = TurnProblems.of({
      kind: "provider.rate-limit",
      text: "All anthropic subscriptions of the organization are at their limit. The first is free again at 2026-11-30T14:00:00.000Z. (subscription_limit_reached)",
      body: JSON.stringify({ error: { code: "subscription_limit_reached" } }),
      assistants: [assistant("anthropic", "claude-opus-5-5")],
      modelNames: new Map(),
      providerNames: new Map([["anthropic", "Anthropic"]]),
      admin: false,
      timeZone: "UTC",
    })
    expect(problem.fix).toBe("The next resets Mon 14:00. Pick another model to keep going.")
  })
})
