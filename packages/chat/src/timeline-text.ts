export * as TimelineText from "./timeline-text.js"

import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { DateTime } from "effect"
import { Projection } from "./projection.js"

export interface Retry {
  readonly attempt: number
  readonly message: string
  readonly next: number
}

export interface Notice {
  readonly title: string
  readonly detail?: string
}

// oxlint-disable-next-line no-control-regex -- matches terminal escape sequences
const ansi = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

const capitalize = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1)

const formatters: { compact?: Intl.NumberFormat } = {}

export const retryStatus = (assistants: ReadonlyArray<SessionMessage.Assistant>): Retry | undefined => {
  const last = assistants.at(-1)?.retry
  return last && { attempt: last.attempt, message: last.error.message, next: DateTime.toEpochMillis(last.at) }
}

const errorTitles: Readonly<Record<string, string>> = {
  "provider.auth": "The model provider rejected the credentials.",
  "provider.quota": "The model account is out of credits.",
  "provider.free-limit": "The free limit for this model is used up.",
  "provider.rate-limit": "The model provider is limiting requests. Try again shortly.",
  "provider.timeout": "The model provider did not answer in time.",
  "provider.transport": "Ren could not reach the model provider.",
  "provider.no-route": "This model is not available.",
  "provider.content-filter": "The model provider blocked this content.",
  "provider.invalid-request": "The model provider rejected the request.",
  "provider.internal": "The model provider had an internal error.",
  "provider.unknown": "The model request failed.",
}

export const errorTitle = (kind: string) => errorTitles[kind]

export const errorParts = (text: string) => {
  const colon = text.indexOf(":")
  return colon < 0 ? { head: "", body: text } : { head: text.slice(0, colon + 1), body: text.slice(colon + 1) }
}

export const duration = (millis: number) => {
  if (!(millis >= 0)) return
  const total = Math.round(millis / 1000)
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`
}

export const turnDuration = (
  user: SessionMessage.User | undefined,
  assistants: ReadonlyArray<SessionMessage.Assistant>,
) => {
  const completed = assistants.findLast((message) => message.time.completed)?.time.completed
  if (!user || !completed) return
  const millis = DateTime.toEpochMillis(completed) - DateTime.toEpochMillis(user.time.created)
  return millis >= 0 ? millis : undefined
}

export const copyText = (assistants: ReadonlyArray<SessionMessage.Assistant>) =>
  assistants
    .flatMap((message) =>
      Projection.contentEntries(message).flatMap((entry) =>
        entry.content.type === "text" && entry.content.text.trim()
          ? [{ messageID: message.id, partID: entry.id, text: entry.content.text }]
          : [],
      ),
    )
    .at(-1)

const usage = (tokens: SessionMessage.TokenUsage | undefined) => {
  if (!tokens) return
  const input = tokens.input + tokens.cache.read + tokens.cache.write
  const output = tokens.output + tokens.reasoning
  if (input + output <= 0) return
  formatters.compact ??= new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
  return `${formatters.compact.format(input)} in · ${formatters.compact.format(output)} out`
}

const compactionOutcome = (message: SessionMessage.Compaction) => {
  if (message.status !== "failed") return "Session compacted"
  if (message.error.type === "aborted") return "Session compaction cancelled"
  if (message.error.type === "compaction.interrupted") return "Session compaction interrupted"
  return "Session compaction failed"
}

export const compaction = (message: SessionMessage.Compaction) =>
  message.status === "running"
    ? "Compacting"
    : [compactionOutcome(message), usage(message.tokens)].filter(Boolean).join(" · ")

export const compactionError = (message: SessionMessage.Compaction) =>
  message.status === "failed" && message.error.type !== "aborted" && message.error.type !== "compaction.interrupted"
    ? Projection.unwrapErrorMessage(message.error.message)
    : undefined

const agentNotice = (message: SessionMessage.AgentSwitched): Notice => ({
  title: "Agent changed",
  detail: message.previous
    ? `${capitalize(message.previous)} → ${capitalize(message.agent)}`
    : capitalize(message.agent),
})

const modelNotice = (message: SessionMessage.ModelSwitched): Notice => ({
  title:
    message.model.variant && message.model.variant !== "default"
      ? `${message.model.id} · ${capitalize(message.model.variant)}`
      : message.model.id,
})

export const notice = (message: SessionMessage.Info): Notice | undefined => {
  if (message.type === "agent-switched") return agentNotice(message)
  if (message.type === "model-switched") return modelNotice(message)
  if (message.type === "skill") return { title: `Skill · ${message.name}` }
  if (message.type === "synthetic" || message.type === "system")
    return { title: message.description?.trim() || message.text }
  return undefined
}

export const shellOutput = (text: string) => text.replaceAll(ansi, "").replaceAll(/\r\n?/g, "\n")

export const shellError = (message: SessionMessage.Shell) => {
  if (message.status === "timeout") return "Timed out"
  if (message.status === "killed") return "Cancelled"
  return message.status === "exited" && message.exit ? `Exit ${message.exit}` : undefined
}

export const mentions = (message: SessionMessage.User) =>
  [...(message.files ?? []), ...(message.agents ?? []), ...(message.skills ?? [])]
    .flatMap((item) => (item.mention ? [{ start: item.mention.start, end: item.mention.end }] : []))
    .filter((range) => range.start >= 0 && range.end > range.start && range.end <= message.text.length)
    .toSorted((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((kept, range) => {
      if ((kept.at(-1)?.end ?? 0) <= range.start) kept.push(range)
      return kept
    }, [])

export const modelLabel = (model: SessionModel.Ref, names: ReadonlyMap<string, string>) => {
  if (!model.id) return
  const name = names.get(model.id) ?? model.id
  const variant = model.variant && model.variant !== "default" ? model.variant : undefined
  return variant ? `${name} ${variant.slice(0, 1).toUpperCase()}${variant.slice(1)}` : name
}
