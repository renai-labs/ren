const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
const utcDateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})
const utcMonthFormat = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" })
const shortDateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
const dateTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const weekdayTimeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
const narrowRelativeFormat = new Intl.RelativeTimeFormat("en", { style: "narrow", numeric: "auto" })

export const formatDate = (value: string | Date) => dateFormat.format(new Date(value))

export const formatUtcDate = (value: string | Date) => utcDateFormat.format(new Date(value))

export const formatUtcMonth = (value: string | Date) => utcMonthFormat.format(new Date(value))

export const formatShortDate = (value: string | Date) => shortDateFormat.format(new Date(value))

export const formatDateTime = (value: string | Date) => dateTimeFormat.format(new Date(value))

export const formatClock = (value: number | Date) => clockFormat.format(value)

// oxlint-disable-next-line ren/no-comments -- A reset within the week, such as a limit's: "Thu 18:38".
export const formatWeekdayTime = (value: string | Date) => weekdayTimeFormat.format(new Date(value)).replace(",", "")

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

export const formatTimeInZone = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(instant))

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
