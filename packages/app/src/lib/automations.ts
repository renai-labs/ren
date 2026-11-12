export * as Automations from "./automations.js"

import type { ScheduleInfo, ScheduleRunStatus, ScheduleWhen, WebhookInfo, WebhookRequestOutcome } from "@ren/client"
import { Session } from "@ren/schema/session"
import { Cron, Option, Result, Schema } from "effect"
import { cadenceOf, describe, whenOf, type Cadence, type Frequency } from "./schedules.js"
import { Webhooks } from "./webhooks.js"

const SearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(["automations", "runs"])),
  page: Schema.optional(Schema.Number),
  schedule: Schema.optional(Schema.String),
})

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

const EditorSearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(["settings", "runs"])),
  space: Schema.optional(Schema.String),
})

export type EditorSearch = typeof EditorSearchSchema.Type

export const EditorSearch = Schema.toStandardSchemaV1(EditorSearchSchema)

export const newSlug = "new"

export const listSize = 100

export const runOrigins: ReadonlyArray<Session.Origin> = ["schedule", "webhook"]

// oxlint-disable-next-line ren/no-comments -- The chats that people start. Runs of schedules and webhooks show under Automations, not in the chat list.
export const chatOrigins: ReadonlyArray<Session.Origin> = Session.Origin.literals.filter(
  (origin) => !runOrigins.includes(origin),
)

// oxlint-disable-next-line ren/no-comments -- An automation is the schedule and the webhook of a space that share a slug: one name, one instruction and one agent, with a timed trigger, a request trigger or both.
export interface Automation {
  readonly key: string
  readonly spaceId: string
  readonly slug: string
  readonly name: string
  readonly message: string
  readonly agentId: string | null
  readonly ownerId: string
  readonly updatedAt: string
  readonly schedule: ScheduleInfo | undefined
  readonly webhook: WebhookInfo | undefined
}

const keyOf = (spaceId: string, slug: string) => `${spaceId}/${slug}`

const webhookName = (webhook: WebhookInfo) =>
  webhook.preset ? `${webhook.preset.appName} · ${webhook.name}` : webhook.name

const latest = (...values: ReadonlyArray<string | undefined>) =>
  values.reduce<string>(
    (found, value) => (value !== undefined && Date.parse(value) > Date.parse(found || "0") ? value : found),
    "",
  )

interface Parts {
  readonly schedule?: ScheduleInfo
  readonly webhook?: WebhookInfo
}

const fieldsOf = (part: Parts) => {
  if (part.schedule) return { name: part.schedule.name, message: part.schedule.message, agentId: part.schedule.agentId }
  if (part.webhook)
    return { name: webhookName(part.webhook), message: part.webhook.message ?? "", agentId: part.webhook.agentId }
  return null
}

const automationOf = (key: string, part: Parts): ReadonlyArray<Automation> => {
  const first = part.schedule ?? part.webhook
  const fields = fieldsOf(part)
  if (!first || !fields) return []
  return [
    {
      key,
      spaceId: first.spaceId,
      slug: first.slug,
      ...fields,
      ownerId: first.ownerId,
      updatedAt: latest(part.schedule?.updatedAt, part.webhook?.updatedAt),
      schedule: part.schedule,
      webhook: part.webhook,
    },
  ]
}

export const group = (
  schedules: ReadonlyArray<ScheduleInfo>,
  webhooks: ReadonlyArray<WebhookInfo>,
): ReadonlyArray<Automation> => {
  const parts = new Map<string, Parts>()
  for (const schedule of schedules) {
    const key = keyOf(schedule.spaceId, schedule.slug)
    parts.set(key, { ...parts.get(key), schedule })
  }
  for (const webhook of webhooks) {
    const key = keyOf(webhook.spaceId, webhook.slug)
    parts.set(key, { ...parts.get(key), webhook })
  }
  return [...parts.entries()]
    .flatMap(([key, part]) => automationOf(key, part))
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export const isActive = (automation: Automation) =>
  automation.schedule?.status === "active" || automation.webhook?.mode === "live"

const pausedBySystem = (schedule: ScheduleInfo | undefined) => {
  const reason = schedule?.pausedReason ?? "user"
  return reason !== "user"
}

const needsAttention = (automation: Automation) =>
  pausedBySystem(automation.schedule) || Boolean(automation.webhook?.modeReason)

export const statusOf = (automation: Automation) => {
  if (needsAttention(automation)) return { label: "Needs attention", tone: "attention" as const }
  if (isActive(automation)) return { label: "Active", tone: "active" as const }
  return { label: "Off", tone: "off" as const }
}

const webhookLabel = (webhook: WebhookInfo) => webhook.preset?.appName ?? "Webhook"

export const triggerSummary = (automation: Automation, zone: string) =>
  [
    ...(automation.schedule ? [describe(automation.schedule.when, zone)] : []),
    ...(automation.webhook ? [webhookLabel(automation.webhook)] : []),
  ].join(" · ")

export const nextRunOf = (automation: Automation) =>
  automation.schedule?.status === "active" ? (automation.schedule.nextRunAt ?? undefined) : undefined

export interface Draft {
  readonly spaceId: string
  readonly name: string
  readonly message: string
  readonly agent: string
  readonly active: boolean
  readonly schedule: Cadence | undefined
  readonly webhook: boolean
}

const blankDraft = (spaceId: string): Draft => ({
  spaceId,
  name: "",
  message: "",
  agent: Webhooks.defaultAgent,
  active: true,
  schedule: undefined,
  webhook: false,
})

export const draftOf = (automation: Automation | undefined, spaceId: string, zone: string): Draft => {
  if (!automation) return blankDraft(spaceId)
  return {
    spaceId: automation.spaceId,
    name: automation.name,
    message: automation.message,
    agent: Webhooks.agentValueOf(automation.agentId),
    active: isActive(automation),
    schedule: automation.schedule ? cadenceOf(automation.schedule.when, zone) : undefined,
    webhook: automation.webhook !== undefined,
  }
}

export const startCadence = (frequency: Frequency, zone: string): Cadence => {
  const base = cadenceOf(undefined, zone)
  if (frequency === "custom") return { ...base, frequency, cron: "0 9 * * *" }
  return { ...base, frequency }
}

const sameWhen = (cadence: Cadence, when: ScheduleWhen) =>
  Option.match(whenOf(cadence), {
    onNone: () => false,
    onSome: (next) => JSON.stringify(next) === JSON.stringify(when),
  })

export const problemOf = (draft: Draft) =>
  [
    { failed: draft.spaceId === "", message: "Choose a space." },
    { failed: !draft.schedule && !draft.webhook, message: "Add a trigger." },
    { failed: draft.schedule !== undefined && Option.isNone(whenOf(draft.schedule)), message: "Fix the schedule." },
    { failed: draft.message.trim() === "", message: "Write the instructions for the agent." },
  ].find((check) => check.failed)?.message

const agentChange = (agentId: string | undefined, current: string | null) =>
  (agentId ?? null) === current ? {} : { agentId: agentId ?? null }

// oxlint-disable-next-line ren/no-comments -- The fields of a schedule that a draft changes, so that saving an unchanged schedule does not make you its owner.
export const scheduleChanges = (draft: Draft, current: ScheduleInfo, when: ScheduleWhen) => {
  const name = nameOrDefault(draft.name)
  const message = draft.message.trim()
  return {
    ...(name === current.name ? {} : { name }),
    ...(message === current.message ? {} : { message }),
    ...(draft.schedule && sameWhen(draft.schedule, current.when) ? {} : { when }),
    ...agentChange(Webhooks.agentIdOf(draft.agent), current.agentId),
  }
}

export const webhookChanges = (draft: Draft, current: WebhookInfo) => {
  const name = nameOrDefault(draft.name)
  const message = draft.message.trim()
  const custom = current.preset === null
  return {
    ...(custom && name !== current.name ? { name } : {}),
    ...(custom && message !== current.message ? { message } : {}),
    ...agentChange(Webhooks.agentIdOf(draft.agent), current.agentId),
  }
}

export const nameOrDefault = (name: string) => name.trim() || "Untitled"

export const authHeader = "x-ren-secret"

export const json = (automation: Automation) =>
  JSON.stringify(
    {
      name: automation.name,
      instructions: automation.message,
      agentId: automation.agentId,
      schedule: automation.schedule?.when ?? null,
      webhook: automation.webhook ? { url: automation.webhook.url, mode: automation.webhook.mode } : null,
    },
    null,
    2,
  )

const hours = Array.from({ length: 24 }, (_, hour) => `${`${hour}`.padStart(2, "0")}:00`)

export const timesWith = (time: string) => (hours.includes(time) ? hours : [...hours, time].toSorted())

// oxlint-disable-next-line ren/no-comments -- The next times a schedule runs, for the trigger row and the cron editor.
export const nextRuns = (cadence: Cadence, count: number, now: number): ReadonlyArray<string> => {
  const when = Option.getOrUndefined(whenOf(cadence))
  if (!when) return []
  if ("at" in when) return [when.at]
  const parsed = Cron.parse(when.cron, when.timeZone)
  if (Result.isFailure(parsed)) return []
  const next = Option.liftThrowable(Cron.next)
  const runs: Array<string> = []
  let from = new Date(now)
  while (runs.length < count) {
    const found = next(parsed.success, from)
    if (Option.isNone(found)) break
    if (when.until && found.value.getTime() > Date.parse(when.until)) break
    runs.push(found.value.toISOString())
    from = new Date(found.value.getTime() + 1000)
  }
  return runs
}

export type Tone = "done" | "working" | "failed" | "waiting" | "quiet"

const outcomeTones: Readonly<Record<WebhookRequestOutcome, Tone>> = {
  queued: "waiting",
  started: "done",
  continued: "done",
  answered: "done",
  failed: "failed",
  rejected: "failed",
  recorded: "quiet",
  throttled: "quiet",
  ignored: "quiet",
  duplicate: "quiet",
}

export const outcomeTone = (outcome: WebhookRequestOutcome) => outcomeTones[outcome]

const runTones: Readonly<Record<ScheduleRunStatus, Tone>> = {
  pending: "waiting",
  started: "done",
  skipped: "quiet",
  failed: "failed",
}

export const runTone = (status: ScheduleRunStatus) => runTones[status]
