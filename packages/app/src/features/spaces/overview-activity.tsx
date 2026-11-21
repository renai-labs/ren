import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@ren/ui/card"
import { formatCount } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { formatShortDate } from "@ren/ui/time"
import { BarChart, type Bar } from "../../components/bar-chart.js"
import { Section, useShapeId } from "../../components/page.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useNow } from "../../lib/use-now.js"

const series = [{ label: "Tasks done", fill: "fill-chart-2", swatch: "bg-chart-2" }]

const tasks = (value: number) => `${formatCount(value)} ${value === 1 ? "task" : "tasks"}`

export function OverviewActivity(props: { spaceId: string; period: Insights.Period }) {
  const { api } = RouterContext.useRouterContext()
  const shapeId = useShapeId("overview-activity")
  const window = Insights.windows(props.period, useNow()).current
  const bucket = Insights.bucket(props.period)
  const activity = useQuery(api.insights.query.queryOptions(Insights.input({ spaceId: props.spaceId }, window, bucket)))
  const rows = activity.data?.rows
  const bars: ReadonlyArray<Bar> = rows
    ? rows.map((row, index) => ({
        key: row.key ?? "",
        label: `${bucket === "week" ? "Week of " : ""}${formatShortDate(row.key ?? "")}`,
        values: [row.tasksDone ?? 0],
        partial: index === rows.length - 1,
      }))
    : Array.from({ length: 7 }, (_, index) => ({ key: String(index), label: "", values: [(index % 5) + 1] }))
  return (
    <Section title={`Tasks done per ${bucket}`}>
      <Loading id={shapeId} loading={activity.isPending} label="Loading activity">
        <Card>
          <CardContent>
            <BarChart label={`Tasks done per ${bucket}`} series={series} bars={bars} format={tasks} />
          </CardContent>
        </Card>
      </Loading>
    </Section>
  )
}
