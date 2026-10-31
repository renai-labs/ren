import { DAY, HOUR, MINUTE } from "./time.js"

const usdFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const countFormat = new Intl.NumberFormat("en-US")
const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short" })
const longDayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" })
const longWeekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long" })
const monthDayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

export function formatAge(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

export function formatShortDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

export function formatUsd(value: number): string {
  if (value >= 10_000) return `$${Math.round(value / 1000)}k`
  return `$${usdFormat.format(value)}`
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`
  }
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

export function formatCount(value: number): string {
  return countFormat.format(Math.round(value))
}

export function formatClock24(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function formatDayLabel(t: number): string {
  const d = new Date(t)
  return `${weekdayFormat.format(d)} ${d.getDate()}`
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
