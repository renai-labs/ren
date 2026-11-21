export * as Insights from "./insights.js"

import type { InsightsQueryInput, InsightsRow } from "@ren/client"
import { addDays, startOfDay } from "@ren/ui/factory-model"
import { localTimeZone } from "@ren/ui/time"
import { Schema } from "effect"

export const Period = Schema.Literals(["7d", "30d", "90d"])
export type Period = typeof Period.Type

export const periods: ReadonlyArray<{ readonly value: Period; readonly label: string; readonly days: number }> = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
]

export type Scope = { readonly spaceId?: string | undefined }

export type Window = { readonly from: string; readonly to: string }

export type GroupBy = InsightsQueryInput["groupBy"]

const timezone = localTimeZone()

export function windows(period: Period, now: number) {
  const days = periods.find((each) => each.value === period)?.days ?? 30
  const end = addDays(startOfDay(now), 1)
  const start = addDays(end, -days)
  const iso = (time: number) => new Date(time).toISOString()
  return {
    current: { from: iso(start), to: iso(end) },
    previous: { from: iso(addDays(start, -days)), to: iso(start) },
  }
}

export const input = (
  scope: Scope,
  window: Window,
  groupBy: GroupBy,
  more: Partial<Omit<InsightsQueryInput, "spaceId" | "from" | "to" | "groupBy" | "timezone">> = {},
): InsightsQueryInput => ({
  ...(scope.spaceId ? { spaceId: scope.spaceId } : {}),
  from: window.from,
  to: window.to,
  timezone,
  groupBy,
  orderBy: "cost",
  limit: 50,
  ...more,
})

export const dollars = (micro: number) => micro / 1_000_000

export const cost = (row: InsightsRow) => row.cost.models + row.cost.compute + row.cost.tools

export const tokens = (row: InsightsRow) =>
  row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cacheRead + row.tokens.cacheWrite

export const bucket = (period: Period) => (period === "90d" ? "week" : "day")

export function duration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`
}
