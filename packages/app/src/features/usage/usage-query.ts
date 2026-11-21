export * as UsageQuery from "./usage-query.js"

import { Insights } from "../../lib/insights.js"
import type { UsageSearch } from "./usage-search.js"

export const breakdowns = (scope: Insights.Scope): ReadonlyArray<UsageSearch.Breakdown> =>
  scope.spaceId ? ["member", "agent", "model"] : ["space", "member", "model"]

export const periodOf = (search: UsageSearch.Search) => search.period ?? "30d"

export const days = (search: UsageSearch.Search) =>
  Insights.periods.find((each) => each.value === periodOf(search))?.days ?? 30

export const filtered = (search: UsageSearch.Search) =>
  Boolean(search.space || search.member || search.agent || search.model)

export const scopeOf = (scope: Insights.Scope, search: UsageSearch.Search): Insights.Scope =>
  scope.spaceId || !search.space ? scope : { spaceId: search.space }

const filtersOf = (search: UsageSearch.Search) => ({
  ...(search.member && { userId: [search.member] }),
  ...(search.agent && { agent: [search.agent] }),
  ...(search.model && { model: [search.model] }),
})

export const breakdown = (scope: Insights.Scope, search: UsageSearch.Search, by: UsageSearch.Breakdown, now: number) =>
  Insights.input(scope, Insights.windows(periodOf(search), now).current, by, {
    ...filtersOf(search),
    ...(by === "model" && { type: ["model.call"] }),
    limit: 100,
  })

export function inputs(scope: Insights.Scope, search: UsageSearch.Search, now: number) {
  const period = periodOf(search)
  const window = Insights.windows(period, now)
  const filters = filtersOf(search)
  return {
    current: Insights.input(scope, window.current, "none", filters),
    previous: Insights.input(scope, window.previous, "none", filters),
    series: Insights.input(scope, window.current, Insights.bucket(period), filters),
  }
}

export function all(base: Insights.Scope, search: UsageSearch.Search, now: number) {
  const scope = scopeOf(base, search)
  return [
    ...Object.values(inputs(scope, search, now)),
    ...breakdowns(scope).map((by) => breakdown(scope, search, by, now)),
  ]
}
