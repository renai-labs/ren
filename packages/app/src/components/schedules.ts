export * as Schedules from "./schedules.js"

import type { ScheduleInfo, ScheduleRunInfo, ScheduleWhen } from "@ren/client"
import { Cron, DateTime, Option, Result } from "effect"

export const frequencies = ["hourly", "daily", "weekdays", "weekly", "monthly", "custom", "once"] as const
export type Frequency = (typeof frequencies)[number]

export const frequencyOptions = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "custom", label: "Custom cron" },
  { value: "once", label: "Once" },
] satisfies ReadonlyArray<{ value: Frequency; label: string }>

export const weekdays = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
] as const

const weekdayNames = new Map<string, string>(weekdays.map((day) => [day.value, day.label]))

export const monthDays = Array.from({ length: 31 }, (_, index) => ({
  value: `${index + 1}`,
  label: `Day ${index + 1}`,
}))

export interface Cadence {
  readonly frequency: Frequency
  readonly time: string
  readonly weekday: string
  readonly monthDay: string
  readonly cron: string
  readonly date: string
  readonly until: string
  readonly untilTime: string
  readonly timeZone: string
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/u
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u

const pad = (value: number) => `${value}`.padStart(2, "0")

const partsOf = (time: string) => {
  const match = timePattern.exec(time)
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : undefined
}

// oxlint-disable-next-line ren/no-comments -- The cron of a cadence, as ren-v1's schedule builder wrote it.
export const cronOf = (cadence: Cadence) => {
  if (cadence.frequency === "custom") return cadence.cron.trim()
  if (cadence.frequency === "hourly") return "0 * * * *"
  const time = partsOf(cadence.time)
  if (!time) return ""
  const head = `${time.minutes} ${time.hours}`
  if (cadence.frequency === "daily") return `${head} * * *`
  if (cadence.frequency === "weekdays") return `${head} * * 1-5`
  if (cadence.frequency === "weekly") return `${head} * * ${cadence.weekday}`
  return `${head} ${cadence.monthDay} * *`
}

const presets = [
  { frequency: "hourly", pattern: /^0 \* \* \* \*$/u },
  { frequency: "daily", pattern: /^(\d+) (\d+) \* \* \*$/u },
  { frequency: "weekdays", pattern: /^(\d+) (\d+) \* \* 1-5$/u },
  { frequency: "weekly", pattern: /^(\d+) (\d+) \* \* ([0-6](?:,[0-6])*)$/u },
  { frequency: "monthly", pattern: /^(\d+) (\d+) ([1-9]|[12]\d|3[01]) \* \*$/u },
] as const

const instantIn = (date: string, time: string, timeZone: string) => {
  const day = datePattern.exec(date)
  const clock = partsOf(time)
  if (!day || !clock) return Option.none()
  return DateTime.makeZoned(
    { year: Number(day[1]), month: Number(day[2]), day: Number(day[3]), hour: clock.hours, minute: clock.minutes },
    { timeZone, adjustForTimeZone: true },
  )
}

const localOf = (instant: string, timeZone: string) => {
  const parts = DateTime.toParts(DateTime.makeZonedUnsafe(instant, { timeZone }))
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  }
}

// oxlint-disable-next-line ren/no-comments -- The `when` that a cadence sends: a one-time schedule is an instant in its time zone; an end date ends after its last minute.
export const whenOf = (cadence: Cadence): Option.Option<ScheduleWhen> => {
  if (cadence.frequency === "once")
    return Option.map(instantIn(cadence.date, cadence.time, cadence.timeZone), (at) => ({
      at: DateTime.formatIso(at),
    }))
  const cron = cronOf(cadence)
  if (cron === "") return Option.none()
  const until =
    cadence.until === "" ? Option.none() : instantIn(cadence.until, cadence.untilTime || "23:59", cadence.timeZone)
  return Option.some({
    cron,
    timeZone: cadence.timeZone,
    ...Option.match(until, { onNone: () => ({}), onSome: (end) => ({ until: DateTime.formatIso(end) }) }),
  })
}

// oxlint-disable-next-line ren/no-comments -- The cadence that shows a stored `when` in the builder; a cron that no preset writes stays custom.
export const cadenceOf = (when: ScheduleWhen | undefined, fallbackZone: string): Cadence => {
  const empty = {
    frequency: "daily" as Frequency,
    time: "09:00",
    weekday: "1",
    monthDay: "1",
    cron: "0 9 * * *",
    date: "",
    until: "",
    untilTime: "23:59",
    timeZone: fallbackZone,
  }
  if (!when) return empty
  if ("at" in when) return { ...empty, frequency: "once", timeZone: fallbackZone, ...localOf(when.at, fallbackZone) }
  const base = {
    ...empty,
    cron: when.cron,
    timeZone: when.timeZone,
    ...(when.until && {
      until: localOf(when.until, when.timeZone).date,
      untilTime: localOf(when.until, when.timeZone).time,
    }),
  }
  const preset = presets.flatMap((candidate) => {
    const match = candidate.pattern.exec(when.cron)
    return match ? [{ frequency: candidate.frequency, match }] : []
  })[0]
  if (!preset) return { ...base, frequency: "custom" }
  if (preset.frequency === "hourly") return { ...base, frequency: "hourly" }
  const time = `${pad(Number(preset.match[2]))}:${pad(Number(preset.match[1]))}`
  if (preset.frequency === "weekly") return { ...base, frequency: "weekly", time, weekday: preset.match[3] ?? "1" }
  if (preset.frequency === "monthly") return { ...base, frequency: "monthly", time, monthDay: preset.match[3] ?? "1" }
  return { ...base, frequency: preset.frequency, time }
}

const zoneName = (timeZone: string) => timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone

// oxlint-disable-next-line ren/no-comments -- A cron `when` in words, for example “Every day at 09:00 · Berlin”.
export const describe = (when: { readonly cron: string; readonly timeZone: string }) => {
  const cadence = cadenceOf(when, when.timeZone)
  const days = cadence.weekday.split(",").flatMap((value) => {
    const day = weekdayNames.get(value)
    return day ? [day.slice(0, 3)] : []
  })
  const words = {
    hourly: "Every hour",
    daily: `Every day at ${cadence.time}`,
    weekdays: `Every weekday at ${cadence.time}`,
    weekly: `${days.join(", ")} at ${cadence.time}`,
    monthly: `Day ${cadence.monthDay} of each month at ${cadence.time}`,
    custom: `Cron ${when.cron}`,
    once: "",
  }[cadence.frequency]
  return `${words} · ${zoneName(when.timeZone)}`
}

const pauseWords = {
  user: "Paused",
  owner_left: "Owner left",
  agent_removed: "Agent removed",
  failing: "Failing",
} as const

export const statusOf = (schedule: ScheduleInfo) => {
  if (schedule.pausedReason) return { label: pauseWords[schedule.pausedReason], glyph: "Stop" } as const
  if (schedule.status === "ended") return { label: "Ended", glyph: "CircleCheck" } as const
  return { label: "Active", glyph: "Clock" } as const
}

const reasonWords = {
  previous_run_busy: "previous run busy",
  paused: "paused",
  archived: "archived",
  owner_left: "owner left",
  agent_removed: "agent removed",
  chat_archived: "chat archived",
} as const

export const runStatus = (run: ScheduleRunInfo) => {
  if (run.status === "skipped") return `Skipped: ${run.reason ? reasonWords[run.reason] : "unknown"}`
  if (run.status === "failed") return `Failed: ${run.error ?? "unknown error"}`
  if (run.status === "pending") return "Starting"
  return "Started"
}

// oxlint-disable-next-line ren/no-comments -- The state of a table from its query and the rows it shows.
export const tableState = (query: { readonly isPending: boolean; readonly isError: boolean }, rows: number) => {
  if (query.isPending) return "loading" as const
  if (query.isError) return "failed" as const
  return rows === 0 ? ("empty" as const) : ("ready" as const)
}

// oxlint-disable-next-line ren/no-comments -- The next fire that the dialog shows under the cadence, as ren-v1's preview line did; the server decides the real fire time.
export const preview = (cadence: Cadence) => {
  const when = whenOf(cadence)
  if (Option.isNone(when)) return { kind: "invalid" as const }
  if ("at" in when.value) return { kind: "next" as const, at: when.value.at }
  const parsed = Cron.parse(when.value.cron, when.value.timeZone)
  if (Result.isFailure(parsed)) return { kind: "invalid" as const }
  const next = Option.liftThrowable(Cron.next)(parsed.success)
  if (Option.isNone(next)) return { kind: "never" as const }
  const until = when.value.until
  if (until && next.value.getTime() > Date.parse(until)) return { kind: "never" as const }
  return { kind: "next" as const, at: next.value.toISOString() }
}
