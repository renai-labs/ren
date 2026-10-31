const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
const shortDateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
const dateTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
const narrowRelativeFormat = new Intl.RelativeTimeFormat("en", { style: "narrow", numeric: "auto" })

const units = [
  { unit: "year", ms: 365 * 86_400_000 },
  { unit: "month", ms: 30 * 86_400_000 },
  { unit: "week", ms: 7 * 86_400_000 },
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
] as const

export const formatDate = (value: string | Date) => dateFormat.format(new Date(value))

export const formatShortDate = (value: string | Date) => shortDateFormat.format(new Date(value))

export const formatDateTime = (value: string | Date) => dateTimeFormat.format(new Date(value))

export const formatClock = (value: number | Date) => clockFormat.format(value)

export function formatRelative(value: string | Date, now = Date.now()) {
  const difference = new Date(value).getTime() - now
  const found = units.find((each) => Math.abs(difference) >= each.ms)
  if (!found) return "just now"
  return relativeFormat.format(Math.round(difference / found.ms), found.unit)
}

export function formatCountdown(value: string, now: number) {
  const minutes = Math.round((Date.parse(value) - now) / 60_000)
  if (minutes < 60) return narrowRelativeFormat.format(minutes, "minute")
  if (minutes < 24 * 60) return narrowRelativeFormat.format(Math.round(minutes / 60), "hour")
  return narrowRelativeFormat.format(Math.round(minutes / (24 * 60)), "day")
}

export const formatInZone = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(instant))

const legacyZones: Readonly<Record<string, string>> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
}

export function localTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return legacyZones[zone] ?? zone
}

export function timeZones() {
  const zones = Intl.supportedValuesOf("timeZone")
  return zones.includes("UTC") ? zones : ["UTC", ...zones]
}

export const civilDate = (date: Date) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-")
