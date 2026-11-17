export * as TurnProblems from "./turn-problems.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"

export type Action = "try" | "continue" | "model" | "billing" | "providers" | "new" | "stop"

export interface Handlers {
  readonly onTryAgain?: (() => void) | undefined
  readonly onContinue?: (() => void) | undefined
  readonly onChangeModel?: (() => void) | undefined
  readonly onStop?: (() => void) | undefined
}

export interface Problem {
  readonly title: string
  readonly fix: string
  readonly actions: ReadonlyArray<Action>
}

export interface Retrying {
  readonly title: string
  readonly text: string
  readonly at: number
  readonly attempt: number
}

const providerLabels: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" }

export const providerLabel = (id: string) => providerLabels[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

const resetPhrase = (text: string) => /\b(?:resets?|try again)\s+((?:in|at|on)\s+[^.,;]+)/iu.exec(text)?.at(1)?.trim()

interface Context {
  readonly kind: string
  readonly text: string
  readonly provider: string
  readonly model: string
  readonly midTurn: boolean
  readonly admin: boolean
  readonly elsewhere: string
}

const outOfCredits = (input: Context): Problem => {
  if (input.midTurn)
    return {
      title: "Ren ran out of credits partway through.",
      fix: input.admin
        ? "Add credits, then hit Continue to pick up where Ren left off."
        : "Ask an admin to add credits, then hit Continue to pick up where Ren left off.",
      actions: input.admin ? ["continue", "billing", "providers"] : ["continue"],
    }
  return {
    title: "You’re out of Ren credits.",
    fix: input.admin
      ? "Add credits, or connect your own Claude or ChatGPT account in Providers. Then try again."
      : "Ask an admin to add credits, then try again.",
    actions: input.admin ? ["try", "billing", "providers"] : ["try"],
  }
}

const usageLimit = (input: Context): Problem => {
  const reset = resetPhrase(input.text)
  return {
    title: `You’ve hit your ${input.provider} usage limit.`,
    fix: `${reset ? `It resets ${reset}.` : "It resets soon."} To keep going now, ${input.elsewhere}.`,
    actions: ["model", "try"],
  }
}

const byText: ReadonlyArray<{
  readonly matches: (text: string) => boolean
  readonly problem: (input: Context) => Problem
}> = [
  {
    matches: (text) =>
      /out of ren credits|insufficient_credits/iu.test(text) || (/budget/iu.test(text) && /exceed/iu.test(text)),
    problem: outOfCredits,
  },
  { matches: (text) => /usage limit|weekly limit|plan limit/iu.test(text), problem: usageLimit },
  {
    matches: (text) =>
      /not supported when using .* account|not included in your plan|your plan does not|not available on your plan/iu.test(
        text,
      ),
    problem: (input) => ({
      title: `${input.model} isn’t included in your ${input.provider} plan.`,
      fix: "Pick another model to keep going, or upgrade your plan.",
      actions: ["model"],
    }),
  },
  {
    matches: (text) => /do not have access to it|does not have access to (the )?model/iu.test(text),
    problem: (input) => ({
      title: `Your ${input.provider} account doesn’t have access to ${input.model}.`,
      fix: "Pick another model to keep going.",
      actions: ["model"],
    }),
  },
  {
    matches: (text) => /model_not_found|does not exist|no such model|model not found/iu.test(text),
    problem: (input) => ({
      title: `${input.model} isn’t available right now.`,
      fix: "Pick another model to keep going.",
      actions: ["model"],
    }),
  },
  {
    matches: (text) => /context length|context window|too long|maximum context/iu.test(text),
    problem: (input) => ({
      title: `This chat is too long for ${input.model}.`,
      fix: "Start a new chat, or pick a model that can handle more.",
      actions: ["new", "model"],
    }),
  },
  {
    matches: (text) => /temporarily unavailable|not available now/iu.test(text),
    problem: (input) => ({
      title: `Your ${input.provider} account is temporarily unavailable.`,
      fix: "Give it a few minutes, then try again.",
      actions: ["try"],
    }),
  },
  {
    matches: (text) => /subscription/iu.test(text) && /inactive|expired|cancel|not active|payment/iu.test(text),
    problem: (input) => ({
      title: `Your ${input.provider} subscription isn’t active.`,
      fix: `Renew it, or ${input.elsewhere}.`,
      actions: ["model", "try"],
    }),
  },
]

const providerDown = (input: Context): Problem => ({
  title: `${input.provider} didn’t respond.`,
  fix: `Try again, or ${input.elsewhere}.`,
  actions: ["try", "model"],
})

const byKind: Readonly<Record<string, (input: Context) => Problem>> = {
  "provider.free-limit": (input) => ({
    title: `${input.model} isn’t included in your plan.`,
    fix: "Pick another model to keep going.",
    actions: ["model"],
  }),
  "provider.quota": (input) => ({
    title: `${input.provider} models are down on our side.`,
    fix: `We’re on it. In the meantime, ${input.elsewhere}.`,
    actions: ["model"],
  }),
  "provider.rate-limit": (input) => ({
    title: `${input.provider} is getting too many requests.`,
    fix: `Wait a minute and try again, or ${input.elsewhere}.`,
    actions: ["try", "model"],
  }),
  "provider.auth": (input) =>
    input.admin
      ? {
          title: `Ren lost access to your ${input.provider} account.`,
          fix: "Reconnect it in Providers, then try again.",
          actions: ["providers", "try"],
        }
      : {
          title: `Ren lost access to the ${input.provider} account.`,
          fix: "Ask an admin to reconnect it, or pick another model.",
          actions: ["model"],
        },
  "provider.no-route": (input) => ({
    title: `${input.model} isn’t available right now.`,
    fix: "Pick another model to keep going.",
    actions: ["model"],
  }),
  "provider.content-filter": (input) => ({
    title: `${input.provider} blocked this message.`,
    fix: "Try rewording it.",
    actions: ["try"],
  }),
  "provider.timeout": providerDown,
  "provider.transport": providerDown,
  "provider.internal": providerDown,
}

export function of(input: {
  readonly kind: string
  readonly text: string
  readonly assistants: ReadonlyArray<SessionMessage.Assistant>
  readonly modelNames: ReadonlyMap<string, string>
  readonly admin: boolean
}): Problem {
  const last = input.assistants.at(-1)
  const provider = providerLabel(last?.model.providerID ?? "the model provider")
  const context: Context = {
    kind: input.kind,
    text: input.text,
    provider,
    model: last ? (input.modelNames.get(last.model.id) ?? last.model.id) : "This model",
    midTurn: input.assistants.some((message) => message.content.some((content) => content.type === "tool")),
    admin: input.admin,
    elsewhere: `pick a model from ${provider === "The model provider" ? "another provider" : `a provider other than ${provider}`}`,
  }
  const found = byText.find((rule) => rule.matches(input.text))?.problem ?? byKind[input.kind]
  return found ? found(context) : { title: "Ren couldn’t finish that reply.", fix: "Try again.", actions: ["try"] }
}

export function retrying(assistants: ReadonlyArray<SessionMessage.Assistant>): Retrying | undefined {
  const last = assistants.at(-1)
  const retry = last?.retry
  if (!last || !retry) return
  const provider = providerLabel(last.model.providerID)
  const busy = retry.error.type === "provider.rate-limit" && !/usage limit|weekly/iu.test(retry.error.message)
  return {
    title: busy ? `${provider} is busy right now.` : `${provider} isn’t responding.`,
    text: retry.error.message,
    at: DateTime.toEpochMillis(retry.at),
    attempt: retry.attempt,
  }
}
