export * as Automations from "./automations.js"

import type { ScheduleInfo, ScheduleRunStatus, ScheduleWhen, WebhookInfo, WebhookRequestOutcome } from "@ren/client"
import { Primitive } from "@ren/schema/primitive"
import { Session } from "@ren/schema/session"
import { Slug } from "@ren/util/slug"
import { Cron, Option, Result, Schema } from "effect"
import { cadenceOf, dateKey, describe, whenOf, type Cadence, type Frequency } from "./schedules.js"
import { Webhooks } from "./webhooks.js"

const SearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(["automations", "runs"])),
  kind: Schema.optional(Schema.Literals(["schedules", "webhooks"])),
  schedule: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
})

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

const EditorSearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(["settings", "runs"])),
  space: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
})

export type EditorSearch = typeof EditorSearchSchema.Type

export const EditorSearch = Schema.toStandardSchemaV1(EditorSearchSchema)

export const newSlug = "new"

export const listSize = 100

export const kinds = [
  { value: "schedules", label: "Schedules" },
  { value: "webhooks", label: "Webhooks" },
] as const

export type ListKind = (typeof kinds)[number]["value"]

export const runOrigins: ReadonlyArray<Session.Origin> = ["schedule", "webhook"]

// oxlint-disable-next-line ren/no-comments -- The chats that people start. Runs of schedules and webhooks show under Automations; search leaves them out, and the chat list shows them only when its filter asks for them.
export const chatOrigins: ReadonlyArray<Session.Origin> = Session.Origin.literals.filter(
  (origin) => !runOrigins.includes(origin),
)

// oxlint-disable-next-line ren/no-comments -- An automation is one schedule or one webhook of a space: a name, the instructions for the agent and its one trigger.
export interface Automation {
  readonly key: string
  readonly handle: string
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

const webhookName = (webhook: WebhookInfo) =>
  webhook.preset ? `${webhook.preset.appName} · ${webhook.name}` : webhook.name

export const ofSchedule = (schedule: ScheduleInfo): Automation => ({
  key: schedule.id,
  handle: schedule.slug,
  spaceId: schedule.spaceId,
  slug: schedule.slug,
  name: schedule.name,
  message: schedule.message,
  agentId: schedule.agentId,
  ownerId: schedule.ownerId,
  updatedAt: schedule.updatedAt,
  schedule,
  webhook: undefined,
})

export const ofWebhook = (webhook: WebhookInfo): Automation => ({
  key: webhook.id,
  handle: webhook.slug,
  spaceId: webhook.spaceId,
  slug: webhook.slug,
  name: webhookName(webhook),
  message: webhook.message ?? "",
  agentId: webhook.agentId,
  ownerId: webhook.ownerId,
  updatedAt: webhook.updatedAt,
  schedule: undefined,
  webhook,
})

export type Kind = "schedule" | "webhook"

export const kindOf = (automation: Automation): Kind => (automation.schedule ? "schedule" : "webhook")

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

export interface PresetRef {
  readonly appId: string
  readonly preset: string
}

export type Trigger =
  | { readonly kind: "schedule"; readonly cadence: Cadence }
  | { readonly kind: "webhook"; readonly preset: PresetRef | null }

export type Target = ScheduleInfo["target"]

export interface Draft {
  readonly spaceId: string
  readonly name: string
  readonly message: string
  readonly agent: string
  readonly active: boolean
  readonly trigger: Trigger | undefined
  readonly target: Target
  readonly fallback: string | null
}

const presetOf = (webhook: WebhookInfo | undefined): PresetRef | null =>
  webhook?.preset ? { appId: webhook.preset.appId, preset: webhook.preset.preset } : null

const triggerOf = (automation: Automation, zone: string): Trigger =>
  automation.schedule
    ? { kind: "schedule", cadence: cadenceOf(automation.schedule.when, zone) }
    : { kind: "webhook", preset: presetOf(automation.webhook) }

export const presetKey = (preset: PresetRef) => `${preset.appId}/${preset.preset}`

export const presetOfDraft = (draft: Draft) => (draft.trigger?.kind === "webhook" ? draft.trigger.preset : null)

export const draftOf = (automation: Automation | undefined, spaceId: string, zone: string): Draft => {
  if (!automation)
    return {
      spaceId,
      name: "",
      message: "",
      agent: Webhooks.defaultAgent,
      active: true,
      trigger: undefined,
      target: "new-chat",
      fallback: null,
    }
  return {
    spaceId: automation.spaceId,
    name: automation.name,
    message: automation.message,
    agent: Webhooks.agentValueOf(automation.agentId),
    active: isActive(automation),
    trigger: triggerOf(automation, zone),
    target: automation.schedule?.target ?? "new-chat",
    fallback: automation.webhook?.fallbackUserId ?? null,
  }
}

export const cadenceOfDraft = (draft: Draft) => (draft.trigger?.kind === "schedule" ? draft.trigger.cadence : undefined)

export const startCadence = (frequency: Frequency, zone: string, current: Cadence | undefined): Cadence => {
  const base = current ?? cadenceOf(undefined, zone)
  if (frequency === "once")
    return { ...base, frequency, date: base.date || dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000)) }
  if (frequency !== "custom") return { ...base, frequency }
  const when = current ? Option.getOrUndefined(whenOf(current)) : undefined
  return { ...base, frequency, cron: when && "cron" in when ? when.cron : base.cron }
}

const sameWhen = (cadence: Cadence, when: ScheduleWhen) =>
  Option.match(whenOf(cadence), {
    onNone: () => false,
    onSome: (next) => JSON.stringify(next) === JSON.stringify(when),
  })

export const problemOf = (draft: Draft) => {
  const cadence = cadenceOfDraft(draft)
  return [
    { failed: draft.spaceId === "", message: "Choose a space." },
    { failed: draft.trigger === undefined, message: "Add a trigger." },
    {
      failed: cadence !== undefined && Option.isNone(whenOf(cadence)),
      message: cadence?.frequency === "once" ? "Pick a date and a time." : "Fix the schedule.",
    },
    {
      failed: cadence?.frequency === "once" && nextRuns(cadence, 1, Date.now()).length === 0,
      message: "Pick a time in the future.",
    },
    { failed: draft.message.trim() === "", message: "Write the instructions for the agent." },
  ].find((check) => check.failed)?.message
}

const agentChange = (agentId: string | undefined, current: string | null) =>
  (agentId ?? null) === current ? {} : { agentId: agentId ?? null }

// oxlint-disable-next-line ren/no-comments -- The fields of a schedule that a draft changes, so that saving an unchanged schedule does not make you its owner.
export const scheduleChanges = (draft: Draft, current: ScheduleInfo, when: ScheduleWhen) => {
  const name = nameOrDefault(draft.name)
  const message = draft.message.trim()
  return {
    ...(name === current.name ? {} : { name }),
    ...(message === current.message ? {} : { message }),
    ...(draft.trigger?.kind === "schedule" && sameWhen(draft.trigger.cadence, current.when) ? {} : { when }),
    ...agentChange(Webhooks.agentIdOf(draft.agent), current.agentId),
    ...(JSON.stringify(draft.target) === JSON.stringify(current.target) ? {} : { target: draft.target }),
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
    ...(draft.fallback === current.fallbackUserId ? {} : { fallbackUserId: draft.fallback }),
  }
}

export const scheduleUndo = (changed: ReturnType<typeof scheduleChanges>, current: ScheduleInfo) => ({
  ...("name" in changed && { name: current.name }),
  ...("message" in changed && { message: current.message }),
  ...("when" in changed && { when: current.when }),
  ...("agentId" in changed && { agentId: current.agentId }),
  ...("target" in changed && { target: current.target }),
})

export const webhookUndo = (changed: ReturnType<typeof webhookChanges>, current: WebhookInfo) => ({
  ...("name" in changed && { name: current.name }),
  ...("message" in changed && current.message !== null && { message: current.message }),
  ...("agentId" in changed && { agentId: current.agentId }),
  ...("fallbackUserId" in changed && { fallbackUserId: current.fallbackUserId }),
})

export const nameOrDefault = (name: string) => name.trim() || "Untitled"

// oxlint-disable-next-line ren/no-comments -- A slug that no schedule and no webhook of the space has, so a new automation never takes the address of another.
export const freeSlug = (name: string, taken: ReadonlySet<string>) =>
  Slug.free(
    Slug.of(nameOrDefault(name), Primitive.maximumSlugLength) || "automation",
    new Set([...taken, newSlug]),
    Primitive.maximumSlugLength,
  )

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

// oxlint-disable-next-line ren/no-comments -- The next times a schedule runs, for the trigger row and the cron editor.
export const nextRuns = (cadence: Cadence, count: number, now: number): ReadonlyArray<string> => {
  const when = Option.getOrUndefined(whenOf(cadence))
  if (!when) return []
  if ("at" in when) return Date.parse(when.at) > now ? [when.at] : []
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
