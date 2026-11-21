export * as ChatFilters from "./chat-filters.js"

import { SessionPages } from "./session-pages.js"

export const origins = [
  { value: "chat", label: "Chat" },
  { value: "task", label: "Task" },
  { value: "schedule", label: "Schedule" },
  { value: "slack", label: "Slack" },
  { value: "linear", label: "Linear" },
  { value: "github", label: "GitHub" },
  { value: "webhook", label: "Webhook" },
] as const

export type Origin = (typeof origins)[number]["value"]

export const isOrigin = (value: string): value is Origin => origins.some((origin) => origin.value === value)

export const statuses = [
  { value: "busy", label: "Working" },
  { value: "idle", label: "Idle" },
] as const

export const updated = [
  { value: "today", label: "Today", days: 0 },
  { value: "week", label: "Past 7 days", days: 7 },
  { value: "month", label: "Past 30 days", days: 30 },
] as const

export type Filters = Readonly<Record<string, ReadonlyArray<string> | undefined>>

const startOfDayAgo = (days: number) => {
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - days)
  return day.toISOString()
}

export const toFilter = (filters: Filters, userId: string): SessionPages.Filter => {
  const status = filters.status?.length === 1 ? filters.status.at(0) : undefined
  const range = updated.find((each) => each.value === filters.updated?.at(0))
  const origin = (filters.origin ?? []).filter(isOrigin)
  return {
    ...SessionPages.own(userId),
    ...(filters.space?.length && { spaceId: filters.space }),
    ...((status === "idle" || status === "busy") && { status }),
    ...(origin.length > 0 && { origin }),
    ...(range && { from: startOfDayAgo(range.days) }),
  }
}
