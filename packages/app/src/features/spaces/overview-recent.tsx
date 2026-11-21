import type { TaskInfo } from "@ren/client"
import { Tasks } from "@ren/client/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { formatDateTime } from "@ren/ui/time"
import { RelativeTime } from "@ren/util/relative-time"
import { Row, RowsSample, Section, useShapeId } from "../../components/page.js"
import { PullRequestIcon } from "../../components/pull-request-icon.js"
import { StatusIcon } from "../../components/task-meta.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useNow } from "../../lib/use-now.js"
import { OverviewRows } from "./overview-rows.js"

const limit = 5

function DoneRow(props: { spaceId: string; task: TaskInfo; now: number }) {
  const task = props.task
  return (
    <Row
      title={task.title}
      media={<StatusIcon task={task} />}
      description={<span className="font-mono">{task.identifier}</span>}
      render={<Link to="/spaces/$spaceId/tasks/$taskId" params={{ spaceId: props.spaceId, taskId: task.id }} />}
    >
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        {task.links.some((link) => link.kind === "github_pr") ? (
          <span title="Has a pull request">
            <PullRequestIcon state={undefined} className="size-4" />
            <span className="sr-only">Has a pull request</span>
          </span>
        ) : null}
        <span title={formatDateTime(task.updatedAt)}>{RelativeTime.format(task.updatedAt, props.now)}</span>
      </span>
    </Row>
  )
}

export function OverviewRecent(props: { spaceId: string; period: Insights.Period }) {
  const { client } = RouterContext.useRouterContext()
  const now = useNow()
  const shapeId = useShapeId("overview-recent")
  const since = Date.parse(Insights.windows(props.period, now).current.from)
  const tasks = useQuery(Tasks.all(client, Tasks.listInput(undefined, props.spaceId)))
  const days = Insights.periods.find((each) => each.value === props.period)?.days
  const rows = (tasks.data?.items ?? [])
    .filter((task) => task.status === "done" && Date.parse(task.updatedAt) >= since)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit)
    .map((task) => <DoneRow key={task.id} spaceId={props.spaceId} task={task} now={now} />)
  return (
    <Section
      title="Recently done"
      action={
        <Link
          to="/spaces/$spaceId/tasks"
          params={{ spaceId: props.spaceId }}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          See all tasks
        </Link>
      }
    >
      <Loading id={shapeId} loading={tasks.isPending} label="Loading finished tasks">
        {tasks.isPending ? (
          <RowsSample count={limit} />
        ) : (
          <OverviewRows empty={`No tasks finished in the last ${days} days.`}>{rows}</OverviewRows>
        )}
      </Loading>
    </Section>
  )
}
