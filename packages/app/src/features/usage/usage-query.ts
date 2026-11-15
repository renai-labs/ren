export * as UsageQuery from "./usage-query.js"

import { Insights } from "../../lib/insights.js"
import type { UsageSearch } from "./usage-search.js"

export const breakdowns = (scope: Insights.Scope): ReadonlyArray<UsageSearch.Breakdown> =>
  scope.spaceId ? ["member", "agent", "model", "provider"] : ["space", "member", "agent", "model", "provider"]

export const breakdownOf = (scope: Insights.Scope, search: UsageSearch.Search) =>
  breakdowns(scope).find((each) => each === search.by) ?? breakdowns(scope)[0] ?? "member"

export const periodOf = (search: UsageSearch.Search) => search.period ?? "30d"

export const days = (search: UsageSearch.Search) =>
  Insights.periods.find((each) => each.value === periodOf(search))?.days ?? 30

export const filtered = (search: UsageSearch.Search) => Boolean(search.member || search.agent || search.model)

export function inputs(scope: Insights.Scope, search: UsageSearch.Search, now: number) {
  const period = periodOf(search)
  const window = Insights.windows(period, now)
  const by = breakdownOf(scope, search)
  const filters = {
    ...(search.member && { userId: [search.member] }),
    ...(search.agent && { agent: [search.agent] }),
    ...(search.model && { model: [search.model] }),
  }
  return {
    current: Insights.input(scope, window.current, "none", filters),
    previous: Insights.input(scope, window.previous, "none", filters),
    series: Insights.input(scope, window.current, Insights.bucket(period), filters),
    breakdown: Insights.input(scope, window.current, by, {
      ...filters,
      ...((by === "model" || by === "provider") && { type: ["model.call"] }),
      limit: 100,
    }),
  }
}
