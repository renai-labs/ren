export * as Webhooks from "./webhooks.js"

import type { WebhookDeliveryOutcome, WebhookInfo, WebhookModeReason, WebhookSignature } from "@ren/client"
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconCopy,
  IconHandStop,
  IconMessageCircle,
  IconPlayerSkipForward,
  type Icon,
} from "@tabler/icons-react"
import { Schema } from "effect"

const SearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(["setup", "deliveries"])),
  delivery: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
})

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

export const outcomes: Readonly<Record<WebhookDeliveryOutcome, { readonly label: string; readonly icon: Icon }>> = {
  recorded: { label: "Recorded", icon: IconCircleDashed },
  throttled: { label: "Throttled", icon: IconClock },
  answered: { label: "Answered", icon: IconHandStop },
  started: { label: "Started", icon: IconCircleCheck },
  continued: { label: "Continued", icon: IconMessageCircle },
  ignored: { label: "Ignored", icon: IconPlayerSkipForward },
  duplicate: { label: "Duplicate", icon: IconCopy },
  rejected: { label: "Rejected", icon: IconCircleX },
  failed: { label: "Failed", icon: IconAlertTriangle },
}

export const isOutcome = (value: string | undefined): value is WebhookDeliveryOutcome =>
  value !== undefined && value in outcomes

export const modeReasons: Readonly<Record<WebhookModeReason, string>> = {
  owner_left: "Listening: the owner left the space. Turn it on to run it as you.",
  agent_removed: "Listening: its agent left the space. Pick another agent.",
  parser_broken: "Listening: the parser broke. Ren is fixing it in a repair chat.",
}

export const signatureKinds: ReadonlyArray<{ readonly value: WebhookSignature["kind"]; readonly label: string }> = [
  { value: "none", label: "URL only" },
  { value: "header", label: "Header equals the secret" },
  { value: "hmac", label: "HMAC of the body" },
  { value: "standard", label: "Standard Webhooks" },
  { value: "stripe", label: "Stripe" },
]

const needsSecret = (signature: WebhookSignature | undefined) => (signature?.kind ?? "none") !== "none"

export const canGoLive = (webhook: Pick<WebhookInfo, "parser" | "hasSigningSecret">) =>
  !needsSecret(webhook.parser.signature) || webhook.hasSigningSecret

export const listInput = (spaceId: string) => ({ spaceId, page: 1, pageSize: 50 })

export const ren = "ren"

export const agentIdOf = (value: string) => (value === ren ? undefined : value)

export const agentValueOf = (agentId: string | null) => agentId ?? ren

export type Operator = "is" | "is not" | "is one of" | "exists"

export interface Condition {
  readonly id: string
  readonly path: string
  readonly operator: Operator
  readonly value: string
}

export const operators: ReadonlyArray<Operator> = ["is", "is not", "is one of", "exists"]

const quoted = (value: string) => JSON.stringify(value)

const listOf = (value: string) =>
  `[${value
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each.length > 0)
    .map(quoted)
    .join(", ")}]`

// oxlint-disable-next-line ren/no-comments -- W41: each row writes one CEL condition; the rows join with &&.
export const celOf = (conditions: ReadonlyArray<Condition>) =>
  conditions
    .filter((condition) => condition.path.trim().length > 0)
    .map((condition) => {
      const path = condition.path.trim()
      if (condition.operator === "exists") return `has(${path})`
      if (condition.operator === "is one of") return `${path} in ${listOf(condition.value)}`
      return `${path} ${condition.operator === "is" ? "==" : "!="} ${quoted(condition.value)}`
    })
    .join(" && ")

const pathPattern = '([A-Za-z_][\\w]*(?:\\.[A-Za-z_][\\w]*|\\["[^"]+"\\])*)'

const patterns: ReadonlyArray<{ readonly pattern: RegExp; readonly read: (match: RegExpExecArray) => Condition }> = [
  {
    pattern: new RegExp(`^has\\(${pathPattern}\\)$`, "u"),
    read: (match) => ({ id: crypto.randomUUID(), path: match.at(1) ?? "", operator: "exists", value: "" }),
  },
  {
    pattern: new RegExp(`^${pathPattern} in \\[((?:"[^"]*"(?:, )?)*)\\]$`, "u"),
    read: (match) => ({
      id: crypto.randomUUID(),
      path: match.at(1) ?? "",
      operator: "is one of",
      value: Array.from((match.at(2) ?? "").matchAll(/"([^"]*)"/gu), (each) => each.at(1) ?? "").join(", "),
    }),
  },
  {
    pattern: new RegExp(`^${pathPattern} (==|!=) "([^"]*)"$`, "u"),
    read: (match) => ({
      id: crypto.randomUUID(),
      path: match.at(1) ?? "",
      operator: match.at(2) === "==" ? "is" : "is not",
      value: match.at(3) ?? "",
    }),
  },
]

// oxlint-disable-next-line ren/no-comments -- The rows of a filter that the rows wrote; None when the CEL says more than rows can, so the form opens it as text.
export const conditionsOf = (cel: string | undefined): ReadonlyArray<Condition> | undefined => {
  if (!cel?.trim()) return []
  const parts = cel.split(" && ").map((part) => part.trim())
  const read = parts.map((part) =>
    patterns
      .flatMap((each) => {
        const match = each.pattern.exec(part)
        return match ? [each.read(match)] : []
      })
      .at(0),
  )
  return read.every((condition) => condition !== undefined) ? read : undefined
}

// oxlint-disable-next-line ren/no-comments -- A CEL path to a value of the body: dots for names, brackets for others.
export const pathOf = (keys: ReadonlyArray<string>) =>
  keys.reduce((path, key) => {
    if (/^\d+$/u.test(key)) return `${path}[${key}]`
    return /^[A-Za-z_]\w*$/u.test(key) ? `${path}.${key}` : `${path}[${quoted(key)}]`
  }, "body")

export const sizeOf = (body: string | null) => {
  const bytes = new TextEncoder().encode(body ?? "").length
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}
