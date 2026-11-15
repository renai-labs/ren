import type { SessionInfo, TaskInfo } from "@ren/client"
import { IconAlertTriangle, IconHandStop, IconMessageCircle } from "@tabler/icons-react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { formatRelative } from "@ren/ui/time"
import { cn } from "cn"
import { Row, RowsSample, Section, useShapeId } from "../../components/page.js"
import { StatusIcon } from "../../components/task-meta.js"
import { RouterContext } from "../../lib/router-context.js"
import { sessionTitle, sidebarSessionsOptions } from "../../lib/sessions.js"
import { allTasksOptions, taskListInput } from "../../lib/tasks.js"
import { useNow } from "../../lib/use-now.js"
import { OverviewRows } from "./overview-rows.js"
import { ChatState } from "./space-inbox.js"

const limit = 6

const byRecent = (left: { updatedAt: string }, right: { updatedAt: string }) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt)

function attentionTasks(tasks: ReadonlyArray<TaskInfo>) {
  const open = tasks.filter((task) => task.status === "todo" || task.status === "in_progress")
  return [
    ...open.filter((task) => task.humanReview).toSorted(byRecent),
    ...open.filter((task) => !task.humanReview && task.session?.state === "failed").toSorted(byRecent),
  ]
}

function TaskRow(props: { spaceId: string; task: TaskInfo }) {
  const task = props.task
  const state = task.humanReview
    ? { icon: IconHandStop, label: "Needs review", className: "text-chart-3" }
    : { icon: IconAlertTriangle, label: "Failed", className: "text-destructive" }
  return (
    <Row
      title={task.title}
      media={<StatusIcon task={task} />}
      description={
        <>
          <span className="font-mono">{task.identifier}</span>
          {" · "}
          {task.humanReview ? (task.humanReviewReason ?? "Waiting for your review") : "The agent’s last run failed"}
        </>
      }
      render={<Link to="/spaces/$spaceId/tasks/$taskId" params={{ spaceId: props.spaceId, taskId: task.id }} />}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <state.icon className={cn("size-3.5", state.className)} />
        {state.label}
      </span>
    </Row>
  )
}

function ChatRow(props: { chat: SessionInfo; now: number }) {
  return (
    <Row
      title={sessionTitle(props.chat.title)}
      media={<IconMessageCircle className="size-4 text-muted-foreground" />}
      description={`Chat · ${formatRelative(props.chat.updatedAt, props.now)}`}
      render={<Link to="/sessions/$sessionId" params={{ sessionId: props.chat.id }} />}
    >
      <ChatState chat={props.chat} />
    </Row>
  )
}

function SeeAll(props: { spaceId: string; total: number; tasks: number }) {
  if (props.total <= limit) return null
  return (
    <Link
      to={props.tasks > limit ? "/spaces/$spaceId/tasks" : "/spaces/$spaceId"}
      params={{ spaceId: props.spaceId }}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      See all {props.total}
    </Link>
  )
}

export function OverviewAttention(props: { spaceId: string }) {
  const { client } = RouterContext.useRouterContext()
  const now = useNow()
  const shapeId = useShapeId("overview-attention")
  const tasks = useQuery(allTasksOptions(client, taskListInput({}, props.spaceId)))
  const running = useInfiniteQuery(sidebarSessionsOptions(client, { spaceId: [props.spaceId], status: "busy" }))
  const waiting = attentionTasks(tasks.data?.items ?? [])
  const page = running.data?.pages.at(0)
  const rows = [
    ...waiting.map((task) => <TaskRow key={task.id} spaceId={props.spaceId} task={task} />),
    ...(page?.items ?? []).toSorted(byRecent).map((chat) => <ChatRow key={chat.id} chat={chat} now={now} />),
  ].slice(0, limit)
  const pending = tasks.isPending || running.isPending
  return (
    <Section
      title="Needs you"
      action={<SeeAll spaceId={props.spaceId} total={waiting.length + (page?.total ?? 0)} tasks={waiting.length} />}
    >
      <Loading id={shapeId} loading={pending} label="Loading what needs you">
        {pending ? <RowsSample count={3} /> : <OverviewRows empty="Nothing needs you right now.">{rows}</OverviewRows>}
      </Loading>
    </Section>
  )
}
