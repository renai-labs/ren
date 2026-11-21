import type { InsightsRow } from "@ren/client"
import type { ReactNode } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import { EmptyState } from "../../components/empty-state.js"
import { PageActions } from "../../components/page.js"
import { PeriodSelect } from "../../components/period-select.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useNow } from "../../lib/use-now.js"
import { UsageFilter } from "./usage-filter.js"
import { UsageLists } from "./usage-lists.js"
import { UsageQuery } from "./usage-query.js"
import type { UsageSearch } from "./usage-search.js"
import { UsageChart, UsageTotals } from "./usage-summary.js"

const zero: InsightsRow = {
  key: null,
  label: null,
  sessions: 0,
  calls: 0,
  errors: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  cost: { ren: 0, customer: 0, unpricedCalls: 0, models: 0, compute: 0, tools: 0 },
  computeMs: 0,
  tasksDone: null,
  prsMerged: null,
  prsLinked: null,
}

function UsageEmpty(props: { days: number; filtered: boolean; onClear: () => void }) {
  return (
    <EmptyState
      action={
        props.filtered ? (
          <Button variant="outline" onClick={props.onClear}>
            Clear filters
          </Button>
        ) : null
      }
    >
      {props.filtered
        ? `No usage for these filters in the last ${props.days} days.`
        : `No usage in the last ${props.days} days.`}
    </EmptyState>
  )
}

export function UsageView(props: {
  scope: Insights.Scope
  search: UsageSearch.Search
  onSearchChange: UsageSearch.Change
  actions?: ReactNode
}) {
  const { api } = RouterContext.useRouterContext()
  const now = useNow()
  const scope = UsageQuery.scopeOf(props.scope, props.search)
  const inputs = UsageQuery.inputs(scope, props.search, now)
  const days = UsageQuery.days(props.search)
  const current = useQuery({ ...api.insights.query.queryOptions(inputs.current), placeholderData: keepPreviousData })
  const previous = useQuery({ ...api.insights.query.queryOptions(inputs.previous), placeholderData: keepPreviousData })
  const total = current.data?.rows.at(0) ?? zero
  const filtered = UsageQuery.filtered(props.search)
  const empty = current.data && Insights.cost(total) === 0 && total.calls === 0 && !total.tasksDone
  return (
    <>
      <PageActions>
        {props.actions}
        <UsageFilter scope={props.scope} search={props.search} onSearchChange={props.onSearchChange} />
        <PeriodSelect
          label="Usage period"
          value={UsageQuery.periodOf(props.search)}
          options={Insights.periods}
          onChange={(period) => props.onSearchChange({ period })}
        />
      </PageActions>
      {current.isError ? (
        <EmptyState
          action={
            <Button variant="outline" onClick={() => void current.refetch()}>
              Try again
            </Button>
          }
        >
          Couldn’t load usage.
        </EmptyState>
      ) : null}
      {empty ? (
        <UsageEmpty
          days={days}
          filtered={filtered}
          onClear={() =>
            props.onSearchChange({ space: undefined, member: undefined, agent: undefined, model: undefined })
          }
        />
      ) : null}
      {current.isError || empty ? null : (
        <div className="flex flex-col gap-4">
          <UsageTotals
            total={total}
            previous={previous.data?.rows.at(0)}
            days={days}
            pending={current.isPending}
            stale={current.isPlaceholderData}
          />
          <UsageChart input={inputs.series} total={total} days={days} />
          <UsageLists scope={scope} search={props.search} />
        </div>
      )}
    </>
  )
}
