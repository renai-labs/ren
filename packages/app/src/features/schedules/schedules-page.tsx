import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { LoadingMessage } from "@ren/ui/loading-message"
import { PageShell } from "@ren/ui/page-shell"
import { Pagination } from "@ren/ui/pagination"
import { SearchField } from "@ren/ui/search-field"
import { Select } from "@ren/ui/select"
import { StateMessage } from "@ren/ui/state-message"
import { Switch } from "@ren/ui/switch"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Toolbar } from "@ren/ui/toolbar"
import { Tooltip } from "@ren/ui/tooltip"
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useDeferredValue, useState } from "react"
import type { ReactNode } from "react"
import { ScheduleActions } from "../../components/schedule-actions.js"
import { ScheduleDialog } from "../../components/schedule-dialog.js"
import { ScheduleWhen } from "../../components/schedule-when.js"
import { Schedules } from "../../components/schedules.js"
import { RouterContext } from "../../lib/router-context.js"
import { ScheduleQueries } from "./schedule-queries.js"

const allSpaces = "all"

const pageSize = 9

const stateOptions = [
  { value: "any", label: "Any state" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
] as const

type State = (typeof stateOptions)[number]["value"]

// oxlint-disable-next-line ren/no-comments -- schedules S23, as ren-v1's Scheduled page: search, filters, a three-up card grid by name, nine to a page.
export function SchedulesPage() {
  const context = RouterContext.useRouterContext()
  const schedules = useQuery({ ...ScheduleQueries.listOptions(context.api), refetchInterval: 10_000 })
  const spaces = useQuery(ScheduleQueries.spaceOptions(context.api))
  const [query, setQuery] = useState("")
  const [spaceId, setSpaceId] = useState(allSpaces)
  const [state, setState] = useState<State>("any")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const needle = useDeferredValue(query).trim()
  const spaceItems = spaces.data?.items ?? []
  const spaceNames = new Map(spaceItems.map((space) => [space.id, space.name]))
  const matched = (schedules.data?.items ?? [])
    .filter(
      (schedule) =>
        (spaceId === allSpaces || schedule.spaceId === spaceId) &&
        (state === "any" || schedule.status === state) &&
        Search.matches([schedule.name, schedule.message], needle),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name))
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize))
  const current = Math.min(page, pageCount)
  const visible = matched.slice((current - 1) * pageSize, current * pageSize)
  const filtered = needle !== "" || spaceId !== allSpaces || state !== "any"
  return (
    <PageShell.Root
      title="Schedules"
      subtitle="Work that starts on a schedule instead of a message."
      toolbar={
        <Toolbar.Root>
          <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search schedules" />
          <Select.Root label="State" size="small" value={state} onValueChange={setState} options={stateOptions} />
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
            Create schedule
          </Button>
        </Toolbar.Root>
      }
    >
      <Grid
        state={Schedules.tableState(schedules, visible.length)}
        filtered={filtered}
        onRetry={() => void schedules.refetch()}
      >
        {visible.map((schedule, index) => (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            index={index}
            spaceName={spaceNames.get(schedule.spaceId) ?? "—"}
          />
        ))}
      </Grid>
      {pageCount > 1 ? <Pagination.Numbered page={current} pageCount={pageCount} onPageChange={setPage} /> : null}
      {creating ? <ScheduleDialog onClose={() => setCreating(false)} /> : null}
    </PageShell.Root>
  )
}

function Grid(props: {
  state: "loading" | "failed" | "empty" | "ready"
  filtered: boolean
  onRetry: () => void
  children: ReactNode
}) {
  if (props.state === "loading") return <LoadingMessage placement="section" />
  if (props.state === "failed")
    return <StateMessage state="failed" title="Couldn’t load every schedule." onRetry={props.onRetry} />
  if (props.state === "empty")
    return (
      <StateMessage
        state={props.filtered ? "no-results" : "empty"}
        icon={<Icon glyph="Clock" size="medium" tone="secondary" />}
        title={props.filtered ? "No matching schedules" : "No schedules yet"}
        description={
          props.filtered ? "Try a different search or filter." : "Create one to run a prompt on a recurring cadence."
        }
      />
    )
  return (
    <section aria-label="Schedules" aria-live="polite">
      <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">{props.children}</div>
    </section>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's schedule card: the next run as a relative time, archive, and a switch that pauses or resumes; an ended schedule's switch is off and says why.
function ScheduleCard(props: { schedule: ScheduleInfo; index: number; spaceName: string }) {
  const schedule = props.schedule
  const actions = ScheduleActions.useActions(schedule)
  const status = Schedules.statusOf(schedule)
  const ended = schedule.status === "ended"
  return (
    <>
      <Card.Root
        layout="feature"
        interaction="link"
        render={<Link to="/schedules/$scheduleId" params={{ scheduleId: schedule.id }} />}
        label={`Open schedule: ${schedule.name}`}
        appearanceOrder={props.index}
        media={<Icon glyph="Clock" size="medium" tone="secondary" />}
        title={schedule.name}
        description={
          <>
            {props.spaceName} · <ScheduleWhen when={schedule.when} />
          </>
        }
        metadata={
          schedule.status === "paused" ? null : (
            <Text purpose="body" numerals="tabular" element="span">
              {schedule.nextRunAt ? (
                <Time value={schedule.nextRunAt} format="relative" relativeStyle="narrow" label="Next run" />
              ) : (
                status.label
              )}
            </Text>
          )
        }
        actions={
          <>
            <IconButton size="small" label={`Archive schedule: ${schedule.name}`} onClick={actions.archive}>
              <Icon glyph="Trash2" />
            </IconButton>
            <Tooltip.Root content={ended ? "It ended. Edit its time to run it again." : undefined}>
              <span className="inline-flex">
                <Switch
                  size="small"
                  checked={schedule.status === "active"}
                  disabled={ended}
                  onCheckedChange={() => actions.toggle?.onSelect()}
                  label={`${schedule.status === "active" ? "Pause" : "Resume"} schedule: ${schedule.name}`}
                />
              </span>
            </Tooltip.Root>
          </>
        }
      />
      {actions.dialogs}
    </>
  )
}
