import type { InsightsQueryInput, InsightsRow } from "@ren/client"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { Card } from "@ren/ui/card"
import { formatCount, formatTokens, formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { formatShortDate } from "@ren/ui/time"
import { cn } from "cn"
import { Schema } from "effect"
import { BarChart, ChartLegend, type Bar, type BarSeries } from "../../components/bar-chart.js"
import { useShapeId } from "../../components/page.js"
import { Stat, Trend } from "../../components/stat.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { UsageSearch } from "./usage-search.js"

const money = (value: number) => formatUsd(Insights.dollars(value))

const sumOf = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

const series = {
  models: { label: "Models", fill: "fill-chart-1", swatch: "bg-chart-1" },
  compute: { label: "Compute", fill: "fill-chart-6", swatch: "bg-chart-6" },
  tools: { label: "Tool calls", fill: "fill-chart-3", swatch: "bg-chart-3" },
} satisfies Record<string, BarSeries>

type Metric = {
  readonly label: string
  readonly series: ReadonlyArray<BarSeries>
  readonly format: (value: number) => string
  readonly values: (row: InsightsRow) => ReadonlyArray<number>
  readonly detail: (row: InsightsRow, previous: InsightsRow | undefined) => ReactNode
}

const metrics: Readonly<Record<UsageSearch.Metric, Metric>> = {
  cost: {
    label: "Cost",
    series: [series.models, series.compute, series.tools],
    format: money,
    values: (row) => [row.cost.models, row.cost.compute, row.cost.tools],
    detail: (row, previous) => (
      <Trend current={Insights.cost(row)} previous={previous && Insights.cost(previous)} upIsGood={false} />
    ),
  },
  compute: {
    label: "Compute",
    series: [series.compute],
    format: money,
    values: (row) => [row.cost.compute],
    detail: (row) => (row.computeMs > 0 ? `${Insights.duration(row.computeMs)} of sandboxes` : undefined),
  },
  chats: {
    label: "Chats",
    series: [{ ...series.models, label: "Chats" }],
    format: formatCount,
    values: (row) => [row.sessions],
    detail: (row, previous) => <Trend current={row.sessions} previous={previous?.sessions} upIsGood />,
  },
  calls: {
    label: "Model calls",
    series: [{ ...series.models, label: "Model calls" }],
    format: formatCount,
    values: (row) => [row.calls],
    detail: (row) => (row.calls > 0 ? `${((row.errors / row.calls) * 100).toFixed(1)}% failed` : undefined),
  },
  tokens: {
    label: "Tokens",
    series: [{ ...series.models, label: "Tokens" }],
    format: formatTokens,
    values: (row) => [Insights.tokens(row)],
    detail: (row) => {
      const read = row.tokens.input + row.tokens.cacheRead + row.tokens.cacheWrite
      return read > 0 ? `${Math.round((row.tokens.cacheRead / read) * 100)}% from cache` : undefined
    },
  },
}

const isMetric = Schema.is(UsageSearch.Metric)

const sampleBars: Readonly<Record<Insights.Period, number>> = { "7d": 7, "30d": 30, "90d": 13 }

export function UsageSummary(props: {
  input: InsightsQueryInput
  total: InsightsRow
  previous: InsightsRow | undefined
  pending: boolean
  stale: boolean
  search: UsageSearch.Search
  onSearchChange: UsageSearch.Change
}) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery({ ...api.insights.query.queryOptions(props.input), placeholderData: keepPreviousData })
  const shapeId = useShapeId("usage-summary")
  const metric = props.search.metric ?? "cost"
  const selected = metrics[metric]
  const rows = query.data?.rows
  const bars: ReadonlyArray<Bar> = rows
    ? rows.map((row, index) => ({
        key: row.key ?? "",
        label: `${props.input.groupBy === "week" ? "Week of " : ""}${formatShortDate(row.key ?? "")}`,
        values: selected.values(row),
        partial: index === rows.length - 1,
      }))
    : Array.from({ length: sampleBars[props.search.period ?? "30d"] }, (_, index) => ({
        key: String(index),
        label: "",
        values: selected.series.map(() => 0),
      }))
  return (
    <Loading id={shapeId} loading={props.pending} label="Loading usage">
      <Card className={cn("gap-0 py-0 transition-opacity", (props.stale || query.isPlaceholderData) && "opacity-60")}>
        <Tabs
          value={metric}
          onValueChange={(value: string) => {
            if (isMetric(value)) props.onSearchChange({ metric: value })
          }}
          className="gap-0"
        >
          <TabsList
            variant="line"
            aria-label="Usage totals"
            className="grid w-full grid-cols-2 gap-0 border-b p-0 group-data-horizontal/tabs:h-auto sm:grid-cols-3 lg:grid-cols-5"
          >
            {UsageSearch.Metric.literals.map((each) => (
              <TabsTrigger
                key={each}
                value={each}
                className="h-auto items-start justify-start rounded-none border-0 px-5 py-4 text-left whitespace-normal group-data-horizontal/tabs:after:bottom-0"
              >
                <Stat
                  label={metrics[each].label}
                  value={metrics[each].format(sumOf(metrics[each].values(props.total)))}
                  detail={metrics[each].detail(props.total, props.previous)}
                />
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={metric} className="flex flex-col gap-4 p-5">
            {query.isError ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Couldn’t load usage over time. Reload to try again.
              </p>
            ) : (
              <>
                {selected.series.length > 1 ? (
                  <ChartLegend series={selected.series} totals={selected.values(props.total).map(selected.format)} />
                ) : null}
                <BarChart
                  label={`${selected.label} per ${props.input.groupBy}`}
                  series={selected.series}
                  bars={bars}
                  format={selected.format}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </Loading>
  )
}
