import type { ScheduleInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
import { Skeleton } from "@ren/ui/skeleton"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { RouterContext } from "../../lib/router-context.js"
import { ScheduleActions } from "../../components/schedule-actions.js"
import { ScheduleWhen } from "../../components/schedule-when.js"
import { Schedules } from "../../components/schedules.js"

// oxlint-disable-next-line ren/no-comments -- schedules S24: the message, the agent, the owner, `when`, and the runs of 30 days.
export function ScheduleDetailPage(props: { scheduleId: string; onArchived: () => void }) {
  const context = RouterContext.useRouterContext()
  const detail = useQuery({
    ...context.api.schedule.get.queryOptions({ idOrSlug: props.scheduleId }),
    refetchInterval: 10_000,
  })
  if (!detail.data)
    return detail.isError ? (
      <Page.Root title="Schedule">
        <Empty role="alert">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon glyph="AlertCircle" tone="danger" />
            </EmptyMedia>
            <EmptyTitle>Couldn’t load this schedule.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </Page.Root>
    ) : (
      <Page.Pending description={<Skeleton className="h-4 w-48" />} />
    )
  return <Detail schedule={detail.data} onArchived={props.onArchived} />
}

function Detail(props: { schedule: ScheduleInfo; onArchived: () => void }) {
  const schedule = props.schedule
  const actions = ScheduleActions.useActions(schedule, { onArchived: props.onArchived })
  const status = Schedules.statusOf(schedule)
  const target = schedule.target
  return (
    <Page.Root
      title={schedule.name}
      description={
        <>
          <ScheduleWhen when={schedule.when} /> · {status.label}
        </>
      }
      menu={
        <>
          <Button variant="outline" size="sm" disabled={actions.isRunning} onClick={actions.run}>
            {actions.isRunning ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <Icon glyph="Play" data-icon="inline-start" />
            )}
            Run now
          </Button>
          <Button variant="outline" size="sm" onClick={actions.edit}>
            <Icon glyph="Pencil" data-icon="inline-start" />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="More schedule actions"
                />
              }
            >
              <Icon glyph="MoreHorizontal" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuGroup>
                {actions.toggle ? (
                  <DropdownMenuItem onClick={actions.toggle.onSelect}>
                    <Icon glyph={actions.toggle.glyph} />
                    {actions.toggle.label}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem variant="destructive" onClick={actions.archive}>
                  <Icon glyph="Trash2" />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <section aria-label="Message" className="flex flex-col gap-2">
        <Text purpose="label" element="h2">
          Message
        </Text>
        <Text purpose="body">{schedule.message}</Text>
        {target === "new-chat" ? null : (
          <Text purpose="caption" tone="secondary">
            <Link to="/sessions/$sessionId" params={{ sessionId: target.sessionId }}>
              Open the chat it sends to
            </Link>
          </Text>
        )}
      </section>
      <section aria-label="Runs" className="flex flex-col gap-2">
        <Text purpose="label" element="h2">
          Runs in the last 30 days
        </Text>
        <Runs schedule={schedule} />
      </section>
      {actions.dialogs}
    </Page.Root>
  )
}

function Runs(props: { schedule: ScheduleInfo }) {
  const context = RouterContext.useRouterContext()
  const runs = useQuery({
    ...context.api["schedule-run"].list.queryOptions({
      scheduleId: props.schedule.id,
      page: 1,
      pageSize: Pagination.maximumPageSize,
    }),
    refetchInterval: 10_000,
  })
  const state = Schedules.tableState(runs, runs.data?.items.length ?? 0)
  return (
    <Page.TableCard>
      <Table className="table-fixed">
        <TableCaption className="sr-only">Runs</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Time</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="w-36">Chat</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state === "ready" ? null : (
            <RunsMessage state={state} nextRunAt={props.schedule.nextRunAt} onRetry={() => void runs.refetch()} />
          )}
          {(runs.data?.items ?? []).map((run) => (
            <TableRow key={run.id}>
              <TableCell className="truncate">
                <Time value={run.scheduledAt} format="date-time" />
              </TableCell>
              <TableCell className="truncate">{Schedules.runStatus(run)}</TableCell>
              <TableCell>
                {run.status === "started" ? (
                  <Link to="/sessions/$sessionId" params={{ sessionId: run.sessionId }}>
                    Open
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page.TableCard>
  )
}

function RunsMessage(props: {
  state: "loading" | "failed" | "empty"
  nextRunAt: ScheduleInfo["nextRunAt"]
  onRetry: () => void
}) {
  return (
    <TableRow>
      <TableCell colSpan={3} className="whitespace-normal">
        {props.state === "loading" ? (
          <Empty>
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
          </Empty>
        ) : null}
        {props.state === "failed" ? (
          <Empty role="alert">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon glyph="AlertCircle" tone="danger" />
              </EmptyMedia>
              <EmptyTitle>Couldn’t load the runs.</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={props.onRetry}>
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {props.state === "empty" ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No runs yet</EmptyTitle>
              {props.nextRunAt ? (
                <EmptyDescription>
                  The next run is <Time value={props.nextRunAt} format="date-time" />.
                </EmptyDescription>
              ) : null}
            </EmptyHeader>
          </Empty>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
