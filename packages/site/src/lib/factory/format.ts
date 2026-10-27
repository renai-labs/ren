import { DAY, HOUR, MINUTE } from "./time.js"

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
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
  return Math.round(value).toLocaleString("en-US")
}

export function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function formatClock24(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function formatDayLabel(t: number): string {
  const d = new Date(t)
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()}`
}

export function formatLongDay(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

export function formatAgo(ms: number): string {
  if (ms < MINUTE) return "just now"
  if (ms < HOUR) {
    const minutes = Math.round(ms / MINUTE)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  }
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR)
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  }
  const days = Math.round(ms / DAY)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

export function formatCompactUsd(value: number): string {
  if (value < 100) return formatUsd(value)
  if (value < 1000) return `$${Math.round(value)}`
  if (value < 10_000) return `$${(Math.round(value / 100) / 10).toFixed(1)}k`
  return `$${Math.round(value / 1000)}k`
}
