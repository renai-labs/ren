export * as RelativeTime from "./relative-time.js"

const units = [
  { unit: "year", ms: 365 * 86_400_000, past: "last year", next: "next year" },
  { unit: "month", ms: 30 * 86_400_000, past: "last month", next: "next month" },
  { unit: "week", ms: 7 * 86_400_000, past: "last week", next: "next week" },
  { unit: "day", ms: 86_400_000, past: "yesterday", next: "tomorrow" },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
] as const

export function format(value: string | Date, now = Date.now()) {
  const difference = new Date(value).getTime() - now
  const found = units.find((each) => Math.abs(difference) >= each.ms)
  if (!found) return "just now"
  const count = Math.round(difference / found.ms)
  if (count === -1 && "past" in found) return found.past
  if (count === 1 && "next" in found) return found.next
  const amount = `${Math.abs(count)} ${found.unit}${Math.abs(count) === 1 ? "" : "s"}`
  return count < 0 ? `${amount} ago` : `in ${amount}`
}
