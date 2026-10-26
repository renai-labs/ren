import type { ScheduleInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { LoadingMessage } from "@ren/ui/loading-message"
import { Menu } from "@ren/ui/menu"
import { PageShell } from "@ren/ui/page-shell"
import { StateMessage } from "@ren/ui/state-message"
import { Table } from "@ren/ui/table"
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
    return (
      <PageShell.Root title="Schedule">
        {detail.isError ? (
          <StateMessage
            state="failed"
            placement="section"
            title="Couldn’t load this schedule."
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <LoadingMessage placement="section" title="Loading schedule…" />
        )}
      </PageShell.Root>
    )
  return <Detail schedule={detail.data} onArchived={props.onArchived} />
}

function Detail(props: { schedule: ScheduleInfo; onArchived: () => void }) {
  const context = RouterContext.useRouterContext()
  const schedule = props.schedule
  const actions = ScheduleActions.useActions(schedule, { onArchived: props.onArchived })
  const runs = useQuery({
    ...context.api["schedule-run"].list.queryOptions({
      scheduleId: schedule.id,
      page: 1,
      pageSize: Pagination.maximumPageSize,
    }),
    refetchInterval: 10_000,
  })
  const status = Schedules.statusOf(schedule)
  const target = schedule.target
  return (
    <PageShell.Root
      title={schedule.name}
      subtitle={
        <>
          <ScheduleWhen when={schedule.when} /> · {status.label}
        </>
      }
      actions={
        <>
          <Button size="small" leadingIcon={<Icon glyph="Play" />} pending={actions.isRunning} onClick={actions.run}>
            Run now
          </Button>
          <Button size="small" leadingIcon={<Icon glyph="Pencil" />} onClick={actions.edit}>
            Edit
          </Button>
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton label="More schedule actions">
                  <Icon glyph="MoreHorizontal" />
                </IconButton>
              }
            />
            <Menu.Popup alignment="end" width="small">
              {actions.toggle ? (
                <Menu.Item icon={<Icon glyph={actions.toggle.glyph} />} onSelect={actions.toggle.onSelect}>
                  {actions.toggle.label}
                </Menu.Item>
              ) : null}
              <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />} onSelect={actions.archive}>
                Archive
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
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
        <Table.Root
          state={Schedules.tableState(runs, runs.data?.items.length ?? 0)}
          caption="Runs"
          emptyMessage="No runs yet"
          emptyDescription={
            schedule.nextRunAt ? (
              <>
                The next run is <Time value={schedule.nextRunAt} format="date-time" />.
              </>
            ) : undefined
          }
          failureMessage="Couldn’t load the runs."
          onRetry={() => void runs.refetch()}
        >
          <Table.Header>
            <Table.HeaderCell width="large">Time</Table.HeaderCell>
            <Table.HeaderCell>Result</Table.HeaderCell>
            <Table.HeaderCell width="medium">Chat</Table.HeaderCell>
          </Table.Header>
          <Table.Body>
            {(runs.data?.items ?? []).map((run) => (
              <Table.Row key={run.id}>
                <Table.Cell>
                  <Time value={run.scheduledAt} format="date-time" />
                </Table.Cell>
                <Table.Cell>{Schedules.runStatus(run)}</Table.Cell>
                <Table.Cell>
                  {run.status === "started" ? (
                    <Link to="/sessions/$sessionId" params={{ sessionId: run.sessionId }}>
                      Open
                    </Link>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </section>
      {actions.dialogs}
    </PageShell.Root>
  )
}
