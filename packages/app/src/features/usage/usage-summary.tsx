import type { InsightsQueryInput, InsightsRow } from "@ren/client"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { formatCount, formatTokens, formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { formatShortDate } from "@ren/ui/time"
import { cn } from "cn"
import { BarChart, ChartLegend, type Bar } from "../../components/bar-chart.js"
import { useShapeId } from "../../components/page.js"
import { Stat, Trend } from "../../components/stat.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"

const money = (value: number) => formatUsd(Insights.dollars(value))

const spend = [
  { label: "Models", fill: "fill-spend-models", swatch: "bg-spend-models" },
  { label: "Compute", fill: "fill-spend-compute", swatch: "bg-spend-compute" },
  { label: "Tool calls", fill: "fill-spend-tools", swatch: "bg-spend-tools" },
]

const parts = (row: InsightsRow) => [row.cost.models, row.cost.compute, row.cost.tools]

const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

export function UsageTotals(props: {
  total: InsightsRow
  previous: InsightsRow | undefined
  days: number
  pending: boolean
  stale: boolean
}) {
  const shapeId = useShapeId("usage-totals")
  const total = props.total
  const since = `vs prior ${props.days}\u00a0days`
  const read = total.tokens.input + total.tokens.cacheRead + total.tokens.cacheWrite
  const figures = [
    {
      label: "Cost",
      value: money(Insights.cost(total)),
      detail: (
        <Trend
          current={Insights.cost(total)}
          previous={props.previous && Insights.cost(props.previous)}
          upIsGood={false}
          since={since}
        />
      ),
    },
    {
      label: "Compute",
      value: money(total.cost.compute),
      detail: total.computeMs > 0 ? `${Insights.duration(total.computeMs)} of sandboxes` : undefined,
    },
    {
      label: "Chats",
      value: formatCount(total.sessions),
      detail: <Trend current={total.sessions} previous={props.previous?.sessions} upIsGood since={since} />,
    },
    {
      label: "Model calls",
      value: formatCount(total.calls),
      detail: total.calls > 0 ? `${percent(total.errors, total.calls).toFixed(1)}% failed` : undefined,
    },
    {
      label: "Tokens",
      value: formatTokens(Insights.tokens(total)),
      detail: read > 0 ? `${Math.round(percent(total.tokens.cacheRead, read))}% from cache` : undefined,
    },
  ]
  return (
    <Loading id={shapeId} loading={props.pending} label="Loading usage totals">
      <Card
        className={cn(
          "grid grid-cols-2 gap-0 py-0 transition-opacity sm:grid-cols-3 lg:grid-cols-5 lg:divide-x",
          props.stale && "opacity-60",
        )}
      >
        {figures.map((figure) => (
          <div key={figure.label} className="px-5 py-4">
            <Stat label={figure.label} value={figure.value} detail={figure.detail} />
          </div>
        ))}
      </Card>
    </Loading>
  )
}

export function UsageChart(props: { input: InsightsQueryInput; total: InsightsRow; days: number }) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery({ ...api.insights.query.queryOptions(props.input), placeholderData: keepPreviousData })
  const shapeId = useShapeId("usage-chart")
  const weekly = props.input.groupBy === "week"
  const title = weekly ? "Cost per week" : "Cost per day"
  const rows = query.data?.rows
  const bars: ReadonlyArray<Bar> = rows
    ? rows.map((row, index) => ({
        key: row.key ?? String(index),
        label: `${weekly ? "Week of " : ""}${formatShortDate(row.key ?? "")}`,
        values: parts(row),
        partial: index === rows.length - 1,
      }))
    : Array.from({ length: weekly ? 13 : props.days }, (_, index) => ({
        key: String(index),
        label: "",
        values: [0, 0, 0],
      }))
  return (
    <Loading id={shapeId} loading={query.isPending} label="Loading cost over time">
      <Card className={cn("gap-4 px-5 py-5 transition-opacity", query.isPlaceholderData && "opacity-60")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="text-sm font-medium">{title}</h2>
          <ChartLegend series={spend} totals={parts(props.total).map(money)} />
        </div>
        {query.isError ? (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            Couldn’t load usage over time.
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <BarChart label={title} series={spend} bars={bars} format={money} />
        )}
      </Card>
    </Loading>
  )
}
