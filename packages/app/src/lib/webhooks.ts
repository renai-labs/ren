export * as Webhooks from "./webhooks.js"

import { parse, unparse } from "@bufbuild/cel"
import type {
  WebhookInfo,
  WebhookModeReason,
  WebhookParser,
  WebhookRequestOutcome,
  WebhookSignature,
} from "@ren/client"
import {
  IconAlertTriangle,
  IconArchive,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCopy,
  IconHandStop,
  IconMessageCircle,
  IconMinus,
  IconProgress,
  type Icon,
} from "@tabler/icons-react"
import { queryOptions } from "@tanstack/react-query"
import { Result, Schema } from "effect"
import type { Runtime } from "./runtime.js"

const SearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(["setup", "requests"])),
  request: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
})

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

export const outcomes: Readonly<Record<WebhookRequestOutcome, { readonly label: string; readonly icon: Icon }>> = {
  queued: { label: "Queued", icon: IconProgress },
  started: { label: "Started", icon: IconCircleCheck },
  continued: { label: "Continued", icon: IconMessageCircle },
  failed: { label: "Failed", icon: IconAlertTriangle },
  recorded: { label: "Recorded", icon: IconArchive },
  throttled: { label: "Throttled", icon: IconClock },
  answered: { label: "Answered", icon: IconHandStop },
  rejected: { label: "Rejected", icon: IconCircleX },
  ignored: { label: "Ignored", icon: IconMinus },
  duplicate: { label: "Duplicate", icon: IconCopy },
}

export const replayable: ReadonlyArray<WebhookRequestOutcome> = ["queued", "recorded", "throttled", "failed"]

export const isOutcome = (value: string | undefined): value is WebhookRequestOutcome =>
  value !== undefined && value in outcomes

export const modeReasons: Readonly<Record<WebhookModeReason, string>> = {
  owner_left: "Debug: the owner and the fallback user left the space. Make it live to run it as you.",
  agent_removed: "Debug: its agent left the space. Pick another agent.",
  parser_broken: "Debug: the parser broke on 5 requests in a row.",
  preset_removed: "Debug: the app no longer has this preset.",
}

export const signatureKinds: ReadonlyArray<{ readonly value: WebhookSignature["kind"]; readonly label: string }> = [
  { value: "none", label: "URL only" },
  { value: "header", label: "Header equals the secret" },
  { value: "hmac", label: "HMAC of the body" },
  { value: "standard", label: "Standard Webhooks" },
  { value: "stripe", label: "Stripe" },
]

const needsSecret = (parser: WebhookParser | null) => (parser?.signature?.kind ?? "none") !== "none"

export const canGoLive = (webhook: Pick<WebhookInfo, "parser" | "hasSigningSecret">) =>
  webhook.parser !== null && (!needsSecret(webhook.parser) || webhook.hasSigningSecret)

export const refreshEvery = 5_000

export const requestOptions = (client: Runtime.Context["client"], id: string) =>
  queryOptions({
    queryKey: ["webhook-request", "get", id] as const,
    queryFn: () => client["webhook-request"].get({ id }),
  })

export const listInput = (spaceId?: string) => ({ ...(spaceId && { spaceId }), page: 1, pageSize: 50 })

export const defaultAgent = "default"

export const agentIdOf = (value: string) => (value === defaultAgent ? undefined : value)

export const agentValueOf = (agentId: string | null) => agentId ?? defaultAgent

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

type Expr = ReturnType<typeof parse>["expr"]

const textOf = (expr: Expr | undefined) => {
  const kind = expr?.exprKind
  return kind?.case === "constExpr" && kind.value.constantKind.case === "stringValue"
    ? kind.value.constantKind.value
    : undefined
}

const comparisons: Readonly<Record<string, Operator>> = { "_==_": "is", "_!=_": "is not" }

const listOfTexts = (expr: Expr) => {
  const values = expr.exprKind.case === "listExpr" ? expr.exprKind.value.elements.map(textOf) : [undefined]
  return values.every((each) => each !== undefined) ? values.join(", ") : undefined
}

const callOf = (name: string, path: Expr, value: Expr): Condition | undefined => {
  const operator = comparisons[name] ?? (name === "@in" ? "is one of" : undefined)
  if (!operator) return undefined
  const text = operator === "is one of" ? listOfTexts(value) : textOf(value)
  if (text === undefined) return undefined
  return { id: crypto.randomUUID(), path: unparse(path), operator, value: text }
}

const conditionOf = (expr: Expr): Condition | undefined => {
  const kind = expr.exprKind
  if (kind.case === "selectExpr" && kind.value.testOnly && kind.value.operand)
    return {
      id: crypto.randomUUID(),
      path: `${unparse(kind.value.operand)}.${kind.value.field}`,
      operator: "exists",
      value: "",
    }
  if (kind.case !== "callExpr") return undefined
  const path = kind.value.args.at(0)
  const value = kind.value.args.at(1)
  return path && value && kind.value.args.length === 2 ? callOf(kind.value.function, path, value) : undefined
}

const conjunctsOf = (expr: Expr): ReadonlyArray<Expr> => {
  const kind = expr.exprKind
  return kind.case === "callExpr" && kind.value.function === "_&&_" ? kind.value.args.flatMap(conjunctsOf) : [expr]
}

export const conditionsOf = (cel: string | undefined): ReadonlyArray<Condition> | undefined => {
  if (!cel?.trim()) return []
  const parsed = Result.try(() => parse(cel))
  if (Result.isFailure(parsed)) return undefined
  const read = conjunctsOf(parsed.success.expr).map(conditionOf)
  return read.every((condition) => condition !== undefined) ? read : undefined
}

export const pathOf = (keys: ReadonlyArray<string>) =>
  keys.reduce((path, key) => {
    if (/^\d+$/u.test(key)) return `${path}[${key}]`
    return /^[A-Za-z_]\w*$/u.test(key) ? `${path}.${key}` : `${path}[${quoted(key)}]`
  }, "body")

export const sizeOf = (bytes: number | null) => {
  if (bytes === null) return "no body"
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}
