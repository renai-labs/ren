import type { ReactNode } from "react"
import type { ScheduleInfo, ScheduleRunInfo, ScheduleRunStatus } from "@ren/client"
import { keepPreviousData, useInfiniteQuery, useQueries } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { formatDateTime } from "@ren/ui/time"
import { cn } from "cn"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import { TableCard, TableSample, useShapeId } from "../../components/page.js"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"
import { isRunStatus, refreshEvery, runColumns, runReasons, runStatuses, runTriggers } from "../../lib/schedules.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/automations/schedules/$scheduleId/")

const all = "all"

const pills = [
  { value: all, label: "All" },
  ...Object.entries(runStatuses).map((entry) => ({ value: entry[0], label: entry[1].label })),
]

export function ScheduleRuns(props: { schedule: ScheduleInfo; actions: ReactNode }) {
  const { client } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const shapeId = useShapeId("schedule-runs")
  const status = isRunStatus(search.status) ? search.status : undefined
  const runs = useInfiniteQuery({
    ...Pages.scheduleRuns(client, { scheduleId: props.schedule.id, ...(status && { status }) }),
    placeholderData: keepPreviousData,
    refetchInterval: refreshEvery,
  })
  const items = runs.data?.pages.flatMap((page) => page.items)
  const setStatus = (value: string | undefined) =>
    void navigate({ search: (previous) => ({ ...previous, status: value }), replace: true })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPills scheduleId={props.schedule.id} status={status} onChange={setStatus} />
        <div className="flex items-center gap-2">{props.actions}</div>
      </div>
      <Loading id={shapeId} loading={!items} label="Loading runs">
        {items ? null : <TableSample columns={runColumns} />}
        {items?.length === 0 ? (
          <RunsEmpty schedule={props.schedule} status={status} onClear={() => setStatus(undefined)} />
        ) : null}
        {items && items.length > 0 ? (
          <TableCard className={cn("transition-opacity", runs.isPlaceholderData && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {runColumns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ) : null}
      </Loading>
      <LoadMore more={runs.hasNextPage} loading={runs.isFetchingNextPage} onMore={() => void runs.fetchNextPage()} />
    </div>
  )
}

function StatusPills(props: {
  scheduleId: string
  status: ScheduleRunStatus | undefined
  onChange: (status: string | undefined) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const counts = useQueries({
    queries: pills.map((pill) => ({
      ...api["schedule-run"].list.queryOptions({
        scheduleId: props.scheduleId,
        ...(isRunStatus(pill.value) && { status: pill.value }),
        page: 1,
        pageSize: 1,
      }),
      select: (page: { readonly total: number }) => page.total,
      refetchInterval: refreshEvery,
    })),
  })
  return (
    <ToggleGroup
      aria-label="Status"
      variant="outline"
      size="sm"
      spacing={1}
      value={[props.status ?? all]}
      onValueChange={(values: string[]) => {
        const value = values.at(0)
        if (value) props.onChange(value === all ? undefined : value)
      }}
    >
      {pills.map((pill, index) => (
        <ToggleGroupItem
          key={pill.value}
          value={pill.value}
          className="gap-2 rounded-full px-3 text-muted-foreground aria-pressed:text-foreground"
        >
          {pill.label} <span className="text-muted-foreground tabular-nums">{counts[index]?.data ?? 0}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function RunsEmpty(props: { schedule: ScheduleInfo; status: ScheduleRunStatus | undefined; onClear: () => void }) {
  const nextRunAt = props.schedule.status === "active" ? props.schedule.nextRunAt : null
  if (props.status)
    return (
      <EmptyState
        title="No matching runs"
        action={
          <Button variant="outline" onClick={props.onClear}>
            Show all runs
          </Button>
        }
      >
        No run in the last 30 days is {runStatuses[props.status].label.toLowerCase()}.
      </EmptyState>
    )
  return (
    <EmptyState title="No runs yet">
      {nextRunAt
        ? `Its runs from the last 30 days show here. The next one is ${formatDateTime(nextRunAt)}.`
        : "Its runs from the last 30 days show here."}
    </EmptyState>
  )
}

function RunRow(props: { run: ScheduleRunInfo }) {
  const run = props.run
  const status = runStatuses[run.status]
  const StatusIcon = status.icon
  const detail = run.status === "skipped" && run.reason ? runReasons[run.reason] : run.error
  return (
    <TableRow>
      <TableCell className="align-top tabular-nums">{formatDateTime(run.scheduledAt)}</TableCell>
      <TableCell className="align-top text-muted-foreground">{runTriggers[run.trigger]}</TableCell>
      <TableCell className="max-w-96 align-top whitespace-normal">
        <span className="flex items-center gap-2">
          <StatusIcon
            className={cn("size-4 shrink-0", run.status === "failed" ? "text-destructive" : "text-muted-foreground")}
          />
          {status.label}
        </span>
        {detail ? (
          <span className="mt-1 line-clamp-2 text-xs break-words text-muted-foreground" title={detail}>
            {detail}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        {run.sessionId ? (
          <Link to="/sessions/$sessionId" params={{ sessionId: run.sessionId }} className="hover:underline">
            Open chat
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}
