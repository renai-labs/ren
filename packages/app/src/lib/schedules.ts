import type { ScheduleInfo, ScheduleListInput, ScheduleWhen } from "@ren/client"
import { Cron, DateTime, Option, Result, Schema } from "effect"
import { formatRelative } from "@/lib/format"

const ScheduleSearchSchema = Schema.Struct({
  page: Schema.optional(Schema.Number),
  filters: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  schedule: Schema.optional(Schema.String),
})

export type ScheduleSearch = typeof ScheduleSearchSchema.Type

export const ScheduleSearch = Schema.toStandardSchemaV1(ScheduleSearchSchema)

export function scheduleListInput(
  search: ScheduleSearch,
  paging: {
    readonly page: number
    readonly pageSize: number
    readonly text?: string | undefined
    readonly spaceId?: string | undefined
  },
): ScheduleListInput {
  const status = search.filters?.state?.at(0)
  const spaceId = paging.spaceId ?? search.filters?.space?.at(0)
  return {
    page: paging.page,
    pageSize: paging.pageSize,
    ...((status === "active" || status === "paused") && { status }),
    ...(spaceId && { spaceId }),
    ...(paging.text && { search: paging.text }),
  }
}

const frequencies = ["hourly", "daily", "weekdays", "weekly", "monthly", "custom", "once"] as const
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

export const isFrequency = (value: unknown): value is Frequency => frequencies.some((frequency) => frequency === value)

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

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export const timeZones = () => {
  const zones = Intl.supportedValuesOf("timeZone")
  return zones.includes("UTC") ? zones : ["UTC", ...zones]
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/u
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u

const pad = (value: number) => `${value}`.padStart(2, "0")

const partsOf = (time: string) => {
  const match = timePattern.exec(time)
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : undefined
}

export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const dateOfKey = (key: string) => {
  const day = datePattern.exec(key)
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : undefined
}

const cronOf = (cadence: Cadence) => {
  if (cadence.frequency === "custom") return cadence.cron.trim()
  if (cadence.frequency === "hourly") return "0 * * * *"
  const time = partsOf(cadence.time)
  if (!time) return ""
  const head = `${time.minutes} ${time.hours}`
  if (cadence.frequency === "daily") return `${head} * * *`
  if (cadence.frequency === "weekdays") return `${head} * * 1-5`
  if (cadence.frequency === "weekly") return cadence.weekday === "" ? "" : `${head} * * ${cadence.weekday}`
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

export const cadenceOf = (when: ScheduleWhen | undefined, fallbackZone: string): Cadence => {
  const empty = {
    frequency: "daily" as Frequency,
    time: "09:00",
    weekday: "1",
    monthDay: "1",
    cron: "0 9 * * *",
    date: "",
    until: "",
    untilTime: "",
    timeZone: fallbackZone,
  }
  if (!when) return empty
  if ("at" in when) return { ...empty, frequency: "once", ...localOf(when.at, fallbackZone) }
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

const clock = (time: string) => {
  const parts = partsOf(time)
  if (!parts) return time
  return `${pad(parts.hours % 12 || 12)}:${pad(parts.minutes)} ${parts.hours < 12 ? "AM" : "PM"}`
}

const zoneName = (timeZone: string) => timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone

export const describeCadence = (cadence: Cadence) => {
  const days = cadence.weekday.split(",").flatMap((value) => {
    const day = weekdayNames.get(value)
    return day ? [day.slice(0, 3)] : []
  })
  return {
    hourly: "Every hour",
    daily: `At ${clock(cadence.time)}, every day`,
    weekdays: `At ${clock(cadence.time)}, every weekday`,
    weekly: `At ${clock(cadence.time)}, on ${days.join(", ")}`,
    monthly: `At ${clock(cadence.time)}, on day ${cadence.monthDay} of the month`,
    custom: `Cron ${cadence.cron.trim()}`,
    once: "Once",
  }[cadence.frequency]
}

export const describe = (when: ScheduleWhen, viewerZone: string) => {
  if ("at" in when) return `Once, ${formatRun(when.at, viewerZone)}`
  const words = describeCadence(cadenceOf(when, when.timeZone))
  return when.timeZone === viewerZone ? words : `${words} · ${zoneName(when.timeZone)}`
}

export const formatRun = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(instant))

const pauseWords = {
  user: "Paused",
  owner_left: "Paused · owner left",
  agent_removed: "Paused · agent removed",
  failing: "Paused · failing",
} as const

export const statusOf = (schedule: ScheduleInfo, now: number) => {
  if (schedule.status === "paused") return pauseWords[schedule.pausedReason ?? "user"]
  if (schedule.status === "ended" || !schedule.nextRunAt) return "Expired"
  return `Next run ${formatRelative(schedule.nextRunAt, now)}`
}

export const nameOf = (message: string) =>
  (
    message
      .trim()
      .split("\n")
      .find((line) => line.trim() !== "") ?? ""
  )
    .trim()
    .slice(0, 80)
    .trim()

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
