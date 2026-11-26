export * as TurnProblems from "./turn-problems.js"

import type { SessionError } from "@ren/schema/session/error"
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

interface Context {
  readonly resetsAt: string | undefined
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
      ? "Add credits, or connect a provider of your own in Providers. Then try again."
      : "Ask an admin to add credits, or pick another model.",
    actions: input.admin ? ["billing", "model", "providers"] : ["model"],
  }
}

const resetFormat = (timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })

const nextReset = (input: Context) =>
  input.resetsAt ? resetFormat(input.timeZone).format(new Date(input.resetsAt)).replace(",", "") : undefined

const askAdmin = (
  input: Context,
  title: string,
  fix: { readonly admin: string; readonly member: string },
): Problem => ({
  title,
  fix: input.admin ? fix.admin : fix.member,
  actions: input.admin ? ["providers", "model"] : ["model"],
})

const providerDown = (input: Context): Problem => ({
  title: `${input.provider} didn’t respond.`,
  fix: `Try again, or ${input.elsewhere}.`,
  actions: ["try", "model"],
})

// oxlint-disable-next-line ren/no-comments -- Providers §9.4, D2: the error's code alone decides the card. The harness adapter names the code from the gateway's refusal or the vendor's answer.
const byCode: Readonly<Record<SessionError.Code, (input: Context) => Problem>> = {
  out_of_credits: outOfCredits,
  free_limit: () => ({
    title: "Free models: today’s 100 requests are used.",
    fix: "They reset at 00:00 UTC.",
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
  model_unavailable: (input) =>
    askAdmin(input, `${input.model} isn’t available anymore.`, {
      admin: `Check ${input.provider} in Providers, or pick another model.`,
      member: "Pick another model, or ask an admin.",
    }),
  subscription_limit: (input) => ({
    title: `All ${input.provider} subscriptions that serve ${input.model} are at their limit.`,
    fix: `The next resets ${nextReset(input) ?? "soon"}. Pick another model to keep going.`,
    actions: ["model"],
  }),
  seat_unavailable: (input) => ({
    title: `No ${input.provider} subscription can serve this now.`,
    fix: "Try again, or pick another model.",
    actions: ["try", "model"],
  }),
  subscription_unsupported: (input) => ({
    title: `${input.provider} subscriptions can’t serve this request.`,
    fix: "Pick another model to keep going.",
    actions: ["model"],
  }),
  inference_unavailable: () => ({ title: "Model access is not available now.", fix: "Try again.", actions: ["try"] }),
  upstream_unfunded: (input) => ({
    title: `${input.provider} models are down on our side.`,
    fix: `We’re on it. In the meantime, ${input.elsewhere}.`,
    actions: ["model"],
  }),
  upstream_down: providerDown,
  rate_limited: (input) => ({
    title: `${input.provider} is getting too many requests.`,
    fix: `Wait a minute and try again, or ${input.elsewhere}.`,
    actions: ["try", "model"],
  }),
  usage_limit: (input) => {
    const reset = nextReset(input)
    return {
      title: `You’ve hit your ${input.provider} usage limit.`,
      fix: `${reset ? `It resets ${reset}.` : "It resets soon."} To keep going now, ${input.elsewhere}.`,
      actions: ["model", "try"],
    }
  },
  plan_excluded: (input) => ({
    title: `${input.model} isn’t included in your ${input.provider} plan.`,
    fix: "Pick another model to keep going, or upgrade your plan.",
    actions: ["model"],
  }),
  no_access: (input) => ({
    title: `Your ${input.provider} account doesn’t have access to ${input.model}.`,
    fix: "Pick another model to keep going.",
    actions: ["model"],
  }),
  subscription_inactive: (input) => ({
    title: `Your ${input.provider} subscription isn’t active.`,
    fix: `Renew it, or ${input.elsewhere}.`,
    actions: ["model", "try"],
  }),
  context_too_long: (input) => ({
    title: `This chat is too long for ${input.model}.`,
    fix: "Start a new chat, or pick a model that can handle more.",
    actions: ["new", "model"],
  }),
  auth_lost: (input) =>
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
  content_blocked: (input) => ({
    title: `${input.provider} blocked this message.`,
    fix: "Try rewording it.",
    actions: ["try"],
  }),
}

export function of(input: {
  readonly code?: SessionError.Code | undefined
  readonly resetsAt?: string | undefined
  readonly assistants: ReadonlyArray<SessionMessage.Assistant>
  readonly modelNames: ReadonlyMap<string, string>
  readonly providerNames?: ReadonlyMap<string, string> | undefined
  readonly admin: boolean
  readonly timeZone?: string | undefined
}): Problem {
  const last = input.assistants.at(-1)
  const provider = providerLabel(last?.model.providerID ?? "the model provider", input.providerNames)
  const context: Context = {
    resetsAt: input.resetsAt,
    timeZone: input.timeZone,
    provider,
    model: last ? (input.modelNames.get(last.model.id) ?? last.model.id) : "This model",
    midTurn: input.assistants.some((message) => message.content.some((content) => content.type === "tool")),
    admin: input.admin,
    elsewhere: `pick a model from ${provider === "The model provider" ? "another provider" : `a provider other than ${provider}`}`,
  }
  return input.code
    ? byCode[input.code](context)
    : { title: "Ren couldn’t finish that reply.", fix: "Try again.", actions: ["try"] }
}

export function retrying(
  assistants: ReadonlyArray<SessionMessage.Assistant>,
  providerNames?: ReadonlyMap<string, string>,
): Retrying | undefined {
  const last = assistants.at(-1)
  const retry = last?.retry
  if (!last || !retry) return
  const provider = providerLabel(last.model.providerID, providerNames)
  const busy = retry.error.code === "rate_limited"
  return {
    title: busy ? `${provider} is busy right now.` : `${provider} isn’t responding.`,
    text: retry.error.message,
    at: DateTime.toEpochMillis(retry.at),
    attempt: retry.attempt,
  }
}
