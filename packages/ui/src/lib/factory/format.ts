import { formatUsd } from "../../components/format.js"
import { MINUTE } from "./time.js"

const longDayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" })
const longWeekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long" })
const monthDayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

export function formatShortDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

export function formatLongDay(t: number): string {
  return longDayFormat.format(t)
}

export function formatCompactUsd(value: number): string {
  if (value < 100) return formatUsd(value)
  if (value < 1000) return `$${Math.round(value)}`
  if (value < 10_000) return `$${(Math.round(value / 100) / 10).toFixed(1)}k`
  return `$${Math.round(value / 1000)}k`
}

export function formatWeekday(t: number): string {
  return longWeekdayFormat.format(t)
}

export function formatMonthDay(t: number): string {
  return monthDayFormat.format(t)
}
