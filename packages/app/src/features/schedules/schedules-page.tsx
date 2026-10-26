import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { Select } from "@ren/ui/select"
import { Table } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Toolbar } from "@ren/ui/toolbar"
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useDeferredValue, useState } from "react"
import { ScheduleActions } from "../../components/schedule-actions.js"
import { ScheduleDialog } from "../../components/schedule-dialog.js"
import { ScheduleWhen } from "../../components/schedule-when.js"
import { Schedules } from "../../components/schedules.js"
import { RouterContext } from "../../lib/router-context.js"
import { ScheduleQueries } from "./schedule-queries.js"

const allSpaces = "all"

// oxlint-disable-next-line ren/no-comments -- schedules S23: the schedules of every space the person is in, with search and a space filter.
export function SchedulesPage() {
  const context = RouterContext.useRouterContext()
  const schedules = useQuery({ ...ScheduleQueries.listOptions(context.api), refetchInterval: 10_000 })
  const spaces = useQuery(ScheduleQueries.spaceOptions(context.api))
  const [query, setQuery] = useState("")
  const [spaceId, setSpaceId] = useState(allSpaces)
  const [creating, setCreating] = useState(false)
  const needle = useDeferredValue(query).trim()
  const spaceItems = spaces.data?.items ?? []
  const spaceNames = new Map(spaceItems.map((space) => [space.id, space.name]))
  const visible = (schedules.data?.items ?? []).filter(
    (schedule) =>
      (spaceId === allSpaces || schedule.spaceId === spaceId) &&
      Search.matches([schedule.name, schedule.message], needle),
  )
  const filtered = needle !== "" || spaceId !== allSpaces
  return (
    <PageShell.Root
      title="Schedules"
      subtitle="Work that starts at a set time instead of a message."
      toolbar={
        <Toolbar.Root>
          <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search schedules" />
          <Select.Root
            label="Space"
            size="small"
            value={spaceId}
            onValueChange={setSpaceId}
            options={[
              { value: allSpaces, label: "All spaces" },
              ...spaceItems.map((space) => ({ value: space.id, label: space.name })),
            ]}
          />
          <Button
            appearance="primary"
            size="small"
            leadingIcon={<Icon glyph="Plus" />}
            onClick={() => setCreating(true)}
          >
            New schedule
          </Button>
        </Toolbar.Root>
      }
    >
      <Table.Root
        state={Schedules.tableState(schedules, visible.length)}
        caption="Schedules"
        emptyIcon={<Icon glyph="CalendarClock" size="medium" tone="secondary" />}
        emptyMessage={filtered ? "No matching schedules" : "No schedules yet"}
        emptyDescription={filtered ? "Try a different search or space." : "A schedule starts a chat at a set time."}
        failureMessage="Couldn’t load schedules."
        onRetry={() => void schedules.refetch()}
      >
        <Table.Header>
          <Table.HeaderCell width="quarter">Name</Table.HeaderCell>
          <Table.HeaderCell width="medium" visibility="wide-screens">
            Space
          </Table.HeaderCell>
          <Table.HeaderCell>When</Table.HeaderCell>
          <Table.HeaderCell width="large" visibility="wide-screens">
            Next run
          </Table.HeaderCell>
          <Table.HeaderCell width="medium">Status</Table.HeaderCell>
          <Table.RowActionsHeaderCell />
        </Table.Header>
        <Table.Body>
          {visible.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} spaceName={spaceNames.get(schedule.spaceId) ?? "—"} />
          ))}
        </Table.Body>
      </Table.Root>
      {creating ? <ScheduleDialog onClose={() => setCreating(false)} /> : null}
    </PageShell.Root>
  )
}

function ScheduleRow(props: { schedule: ScheduleInfo; spaceName: string }) {
  const navigate = useNavigate()
  const schedule = props.schedule
  const status = Schedules.statusOf(schedule)
  const target = schedule.target
  return (
    <Table.Row onActivate={() => void navigate({ to: "/schedules/$scheduleId", params: { scheduleId: schedule.id } })}>
      <Table.Cell>
        <span className="flex min-w-0 flex-col">
          <Link to="/schedules/$scheduleId" params={{ scheduleId: schedule.id }}>
            {schedule.name}
          </Link>
          {target === "new-chat" ? null : (
            <Text purpose="caption" tone="secondary" element="span">
              <Link to="/sessions/$sessionId" params={{ sessionId: target.sessionId }}>
                In a chat
              </Link>
            </Text>
          )}
        </span>
      </Table.Cell>
      <Table.Cell visibility="wide-screens">{props.spaceName}</Table.Cell>
      <Table.Cell>
        <ScheduleWhen when={schedule.when} />
      </Table.Cell>
      <Table.Cell visibility="wide-screens">
        {schedule.nextRunAt ? <Time value={schedule.nextRunAt} format="date-time" /> : "—"}
      </Table.Cell>
      <Table.Cell>
        <span className="flex items-center gap-2">
          <Icon glyph={status.glyph} tone="secondary" />
          {status.label}
        </span>
      </Table.Cell>
      <RowActions schedule={schedule} />
    </Table.Row>
  )
}

function RowActions(props: { schedule: ScheduleInfo }) {
  const actions = ScheduleActions.useActions(props.schedule)
  return (
    <>
      <Table.RowActions label={`Actions for ${props.schedule.name}`}>
        <Menu.Item icon={<Icon glyph="Play" />} onSelect={actions.run}>
          Run now
        </Menu.Item>
        {actions.toggle ? (
          <Menu.Item icon={<Icon glyph={actions.toggle.glyph} />} onSelect={actions.toggle.onSelect}>
            {actions.toggle.label}
          </Menu.Item>
        ) : null}
        <Menu.Item icon={<Icon glyph="Pencil" />} onSelect={actions.edit}>
          Edit
        </Menu.Item>
        <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />} onSelect={actions.archive}>
          Archive
        </Menu.Item>
      </Table.RowActions>
      {actions.dialogs}
    </>
  )
}
