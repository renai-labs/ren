export * as TurnProblems from "./turn-problems.js"

import { Models } from "@ren/schema/models"
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

// oxlint-disable-next-line ren/no-comments -- Providers §5.3: a card's name comes from the chat's model list; an id the list does not name is shown capitalized.
const providerLabel = (id: string, names: ReadonlyMap<string, string> | undefined) =>
  names?.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1)

const resetPhrase = (text: string) => /\b(?:resets?|try again)\s+((?:in|at|on)\s+[^.,;]+)/iu.exec(text)?.at(1)?.trim()

interface Context {
  readonly kind: string
  readonly text: string
  readonly body: string
  readonly timeZone: string | undefined
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
      actions: input.admin ? ["continue", "billing", "model"] : ["continue", "model"],
    }
  return {
    title: "You’re out of Ren credits.",
    fix: input.admin
      ? "Add credits, or connect your own Claude or ChatGPT account in Providers. Then try again."
      : "Ask an admin to add credits, or pick another model.",
    actions: input.admin ? ["billing", "model", "providers"] : ["model"],
  }
}

const resetFormat = (timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })

const nextReset = (input: Context) => {
  const found = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/u.exec(
    `${input.body} ${input.text}`,
  )
  const at = found?.at(0)
  return at ? resetFormat(input.timeZone).format(new Date(at)).replace(",", "") : undefined
}

const askAdmin = (
  input: Context,
  title: string,
  fix: { readonly admin: string; readonly member: string },
): Problem => ({
  title,
  fix: input.admin ? fix.admin : fix.member,
  actions: input.admin ? ["providers", "model"] : ["model"],
})

// oxlint-disable-next-line ren/no-comments -- Providers §9.4: the model gateway's refusals, by the code in its answer. Each one is final: the gateway sends `x-should-retry: false`, so the brain does not try again.
const byCode: Readonly<Record<string, (input: Context) => Problem>> = {
  insufficient_credits: outOfCredits,
  free_limit_reached: () => ({
    title: "Free models: today’s 100 requests are used.",
    fix: "They reset at 00:00 UTC.",
    actions: ["model"],
  }),
  free_unavailable: () => ({
    title: "Free models are limited and not guaranteed.",
    fix: "Try later, add credit or connect a provider.",
    actions: ["model"],
  }),
  provider_not_connected: (input) =>
    askAdmin(input, `${input.provider} is not connected.`, {
      admin: "Connect it in Providers, or pick another model.",
      member: "Ask an admin to connect it, or pick another model.",
    }),
  model_off: (input) =>
    askAdmin(input, `${input.model} is switched off for this organization.`, {
      admin: "Switch it on in Providers, or pick another model.",
      member: "Ask an admin to switch it on, or pick another model.",
    }),
  subscription_limit_reached: (input) => {
    const reset = nextReset(input)
    return {
      title: `All ${input.provider} subscriptions are at their limit.`,
      fix: `The next resets ${reset ?? "soon"}. Pick another model to keep going.`,
      actions: ["model"],
    }
  },
  inference_unavailable: () => ({ title: "Model access is not available now.", fix: "Try again.", actions: ["try"] }),
  ...Object.fromEntries(
    Models.chatGptRefusals.map((code, index) => [
      code,
      (input: Context): Problem =>
        index < 2
          ? { title: "ChatGPT usage limit reached.", fix: "Pick another model to keep going.", actions: ["model"] }
          : { title: "ChatGPT refused this request.", fix: input.text, actions: ["model"] },
    ]),
  ),
}

const codes = Object.keys(byCode)

const codeOf = (body: string, text: string) =>
  codes.find((code) => body.includes(code)) ?? codes.find((code) => text.includes(code))

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
  { matches: (text) => /budget/iu.test(text) && /exceed/iu.test(text), problem: outOfCredits },
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
  readonly body?: string | undefined
  readonly assistants: ReadonlyArray<SessionMessage.Assistant>
  readonly modelNames: ReadonlyMap<string, string>
  readonly providerNames?: ReadonlyMap<string, string> | undefined
  readonly admin: boolean
  readonly timeZone?: string | undefined
}): Problem {
  const last = input.assistants.at(-1)
  const provider = providerLabel(last?.model.providerID ?? "the model provider", input.providerNames)
  const body = input.body ?? ""
  const context: Context = {
    kind: input.kind,
    text: input.text,
    body,
    timeZone: input.timeZone,
    provider,
    model: last ? (input.modelNames.get(last.model.id) ?? last.model.id) : "This model",
    midTurn: input.assistants.some((message) => message.content.some((content) => content.type === "tool")),
    admin: input.admin,
    elsewhere: `pick a model from ${provider === "The model provider" ? "another provider" : `a provider other than ${provider}`}`,
  }
  const code = codeOf(body, input.text)
  const found = (code && byCode[code]) ?? byText.find((rule) => rule.matches(input.text))?.problem ?? byKind[input.kind]
  return found ? found(context) : { title: "Ren couldn’t finish that reply.", fix: "Try again.", actions: ["try"] }
}

export function retrying(
  assistants: ReadonlyArray<SessionMessage.Assistant>,
  providerNames?: ReadonlyMap<string, string>,
): Retrying | undefined {
  const last = assistants.at(-1)
  const retry = last?.retry
  if (!last || !retry) return
  const provider = providerLabel(last.model.providerID, providerNames)
  const busy = retry.error.type === "provider.rate-limit" && !/usage limit|weekly/iu.test(retry.error.message)
  return {
    title: busy ? `${provider} is busy right now.` : `${provider} isn’t responding.`,
    text: retry.error.message,
    at: DateTime.toEpochMillis(retry.at),
    attempt: retry.attempt,
  }
}
