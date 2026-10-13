export type DateInput = Date | string | number

type ZoneOptions = { timeZone?: string | undefined }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const INVALID = "—"

const formatters = new Map<string, Intl.DateTimeFormat>()
const relativeFormatters = new Map<Intl.RelativeTimeFormatStyle, Intl.RelativeTimeFormat>()

const relativeUnits: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; size: number }> = [
  { unit: "second", size: SECOND },
  { unit: "minute", size: MINUTE },
  { unit: "hour", size: HOUR },
  { unit: "day", size: DAY },
  { unit: "month", size: 30 * DAY },
  { unit: "year", size: 365 * DAY },
]

export function toDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value)
}

function buildFormatter(options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(undefined, options)
  } catch {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: undefined })
  }
}

function formatWith(value: DateInput, options: Intl.DateTimeFormatOptions) {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return INVALID
  const key = JSON.stringify(options)
  const formatter = formatters.get(key) ?? buildFormatter(options)
  formatters.set(key, formatter)
  return formatter.format(date)
}

export function formatDate(value: DateInput, options: ZoneOptions = {}) {
  return formatWith(value, { year: "numeric", month: "short", day: "numeric", ...options })
}

export function formatDateShort(value: DateInput, options: ZoneOptions = {}) {
  return formatWith(value, { month: "short", day: "numeric", ...options })
}

export function formatDateTime(value: DateInput, options: ZoneOptions = {}) {
  return formatWith(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  })
}

export function formatTimeOfDay(value: DateInput, options: ZoneOptions = {}) {
  return formatWith(value, { hour: "numeric", minute: "2-digit", ...options })
}

export function formatDateTimeInZone(value: DateInput, timeZone: string) {
  return formatWith(value, {
    timeZone: timeZone === "" ? undefined : timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  })
}

export function formatRelative(value: DateInput, now: number, style: Intl.RelativeTimeFormatStyle = "long") {
  const time = toDate(value).getTime()
  if (Number.isNaN(time)) return INVALID
  const delta = time - now
  const magnitude = Math.abs(delta)
  const step = relativeUnits.findLast((entry) => magnitude >= entry.size) ?? { unit: "second", size: SECOND }
  const formatter = relativeFormatters.get(style) ?? new Intl.RelativeTimeFormat(undefined, { style, numeric: "auto" })
  relativeFormatters.set(style, formatter)
  return formatter.format(Math.trunc(delta / step.size), step.unit)
}

export function formatElapsed(value: DateInput, now: number) {
  const elapsed = Math.max(0, now - toDate(value).getTime())
  if (!Number.isFinite(elapsed)) return INVALID
  const seconds = Math.floor(elapsed / SECOND)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
