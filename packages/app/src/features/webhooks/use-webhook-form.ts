import { createContext, use } from "react"
import type { WebhookInfo, WebhookParser, WebhookSignature } from "@ren/client"
import { Webhooks } from "../../lib/webhooks.js"

export interface Draft {
  readonly message: string
  readonly agent: string
  readonly signature: WebhookSignature
  readonly conditions: ReadonlyArray<Webhooks.Condition> | undefined
  readonly filter: string
  readonly eventId: string
  readonly threadKey: string
  readonly title: string
  readonly handshake: string
  readonly signedHandshake: string
}

export interface Form {
  readonly state: { readonly draft: Draft; readonly changed: boolean }
  readonly actions: {
    readonly set: (patch: Partial<Draft>) => void
    readonly addCondition: (condition: Webhooks.Condition) => void
    readonly reset: (webhook: WebhookInfo) => void
  }
  readonly meta: { readonly parser: WebhookParser }
}

export const FormContext = createContext<Form | undefined>(undefined)

export const draftOf = (webhook: WebhookInfo): Draft => {
  const parser: WebhookParser = webhook.parser ?? {}
  return {
    message: webhook.message ?? "",
    agent: Webhooks.agentValueOf(webhook.agentId),
    signature: parser.signature ?? { kind: "none" },
    conditions: Webhooks.conditionsOf(parser.filter),
    filter: parser.filter ?? "",
    eventId: parser.eventId ?? "",
    threadKey: parser.threadKey ?? "",
    title: parser.title ?? "",
    handshake: parser.handshake ?? "",
    signedHandshake: parser.signedHandshake ?? "",
  }
}

const trimmed = (value: string) => (value.trim().length > 0 ? value.trim() : undefined)

export const parserOf = (draft: Draft): WebhookParser => {
  const filter = trimmed(draft.conditions ? Webhooks.celOf(draft.conditions) : draft.filter)
  const fields = {
    filter,
    eventId: trimmed(draft.eventId),
    threadKey: trimmed(draft.threadKey),
    title: trimmed(draft.title),
    handshake: trimmed(draft.handshake),
    signedHandshake: trimmed(draft.signedHandshake),
  }
  return {
    signature: draft.signature,
    ...Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined)),
  }
}

export function useWebhookForm() {
  const form = use(FormContext)
  if (!form) throw new Error("useWebhookForm needs a WebhookFormProvider")
  return form
}
