import type { InsightsRow } from "@ren/client"
import { IconCircleX } from "@tabler/icons-react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import { EmptyState } from "../../components/empty-state.js"
import { PageActions } from "../../components/page.js"
import { PeriodSelect } from "../../components/period-select.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { UsageBreakdown } from "./usage-breakdown.js"
import { UsageQuery } from "./usage-query.js"
import { UsageSearch } from "./usage-search.js"
import { UsageSummary } from "./usage-summary.js"

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

function FilterChip(props: { label: string; onRemove: () => void }) {
  return (
    <Button variant="outline" size="sm" className="rounded-full" onClick={props.onRemove}>
      {props.label}
      <IconCircleX data-icon="inline-end" />
      <span className="sr-only">, remove filter</span>
    </Button>
  )
}

function UsageFilters(props: { search: UsageSearch.Search; onSearchChange: UsageSearch.Change }) {
  const members = useMembers()
  if (!UsageQuery.filtered(props.search)) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.search.member ? (
        <FilterChip
          label={`Member: ${members.member(props.search.member)?.name ?? "Former member"}`}
          onRemove={() => props.onSearchChange({ member: undefined })}
        />
      ) : null}
      {props.search.agent ? (
        <FilterChip
          label={`Agent: ${props.search.agent}`}
          onRemove={() => props.onSearchChange({ agent: undefined })}
        />
      ) : null}
      {props.search.model ? (
        <FilterChip
          label={`Model: ${props.search.model}`}
          onRemove={() => props.onSearchChange({ model: undefined })}
        />
      ) : null}
    </div>
  )
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
}) {
  const { api } = RouterContext.useRouterContext()
  const now = useNow()
  const inputs = UsageQuery.inputs(props.scope, props.search, now)
  const days = UsageQuery.days(props.search)
  const current = useQuery({ ...api.insights.query.queryOptions(inputs.current), placeholderData: keepPreviousData })
  const previous = useQuery({ ...api.insights.query.queryOptions(inputs.previous), placeholderData: keepPreviousData })
  const total = current.data?.rows.at(0) ?? zero
  const filtered = UsageQuery.filtered(props.search)
  const empty = current.data && Insights.cost(total) === 0 && total.calls === 0 && !total.tasksDone
  return (
    <>
      <PageActions>
        <PeriodSelect
          label="Usage period"
          value={UsageQuery.periodOf(props.search)}
          options={Insights.periods}
          onChange={(period) => props.onSearchChange({ period })}
        />
      </PageActions>
      <UsageFilters search={props.search} onSearchChange={props.onSearchChange} />
      {current.isError ? <EmptyState>Couldn’t load usage.</EmptyState> : null}
      {empty ? (
        <UsageEmpty
          days={days}
          filtered={filtered}
          onClear={() => props.onSearchChange({ member: undefined, agent: undefined, model: undefined })}
        />
      ) : null}
      {current.isError || empty ? null : (
        <>
          <UsageSummary
            input={inputs.series}
            total={total}
            previous={previous.data?.rows.at(0)}
            pending={current.isPending}
            stale={current.isPlaceholderData}
            search={props.search}
            onSearchChange={props.onSearchChange}
          />
          <UsageBreakdown
            scope={props.scope}
            search={props.search}
            input={inputs.breakdown}
            onSearchChange={props.onSearchChange}
          />
        </>
      )}
    </>
  )
}
