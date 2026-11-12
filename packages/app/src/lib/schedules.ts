import type { ScheduleWhen } from "@ren/client"
import { DateTime, Option } from "effect"
import { formatInZone, localTimeZone, timeZones } from "@ren/ui/time"

const frequencies = ["hourly", "daily", "weekdays", "weekly", "monthly", "custom", "once"] as const
export type Frequency = (typeof frequencies)[number]

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

export { localTimeZone, timeZones }

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/u
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u

const pad = (value: number) => `${value}`.padStart(2, "0")

const partsOf = (time: string) => {
  const match = timePattern.exec(time)
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : undefined
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

const describeCadence = (cadence: Cadence) => {
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

export const formatRun = formatInZone
