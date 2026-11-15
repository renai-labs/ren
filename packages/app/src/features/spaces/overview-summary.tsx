import type { InsightsRow } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Card } from "@ren/ui/card"
import { formatCount, formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { useShapeId } from "../../components/page.js"
import { Stat, Trend } from "../../components/stat.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useNow } from "../../lib/use-now.js"

const metrics = [
  { label: "Chats", pick: (row: InsightsRow) => row.sessions, format: formatCount, upIsGood: true },
  { label: "Tasks done", pick: (row: InsightsRow) => row.tasksDone ?? 0, format: formatCount, upIsGood: true },
  {
    label: "Pull requests merged",
    pick: (row: InsightsRow) => row.prsMerged ?? 0,
    format: formatCount,
    upIsGood: true,
  },
  {
    label: "Cost",
    pick: (row: InsightsRow) => Insights.cost(row),
    format: (value: number) => formatUsd(Insights.dollars(value)),
    upIsGood: false,
  },
]

export function OverviewSummary(props: { spaceId: string; period: Insights.Period }) {
  const { api } = RouterContext.useRouterContext()
  const shapeId = useShapeId("overview-summary")
  const windows = Insights.windows(props.period, useNow())
  const current = useQuery(
    api.insights.query.queryOptions(Insights.input({ spaceId: props.spaceId }, windows.current, "none")),
  )
  const previous = useQuery(
    api.insights.query.queryOptions(Insights.input({ spaceId: props.spaceId }, windows.previous, "none")),
  )
  const now = current.data?.rows.at(0)
  const before = previous.data?.rows.at(0)
  return (
    <Loading id={shapeId} loading={current.isPending} label="Loading summary">
      <Card className="grid grid-cols-2 gap-0 py-0 lg:grid-cols-4 lg:divide-x">
        {metrics.map((metric) => {
          const value = now ? metric.pick(now) : 0
          return (
            <div key={metric.label} className="px-5 py-4">
              <Stat
                label={metric.label}
                value={metric.format(value)}
                detail={<Trend current={value} previous={before && metric.pick(before)} upIsGood={metric.upIsGood} />}
              />
            </div>
          )
        })}
      </Card>
    </Loading>
  )
}
