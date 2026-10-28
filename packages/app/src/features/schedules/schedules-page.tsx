import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@ren/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@ren/ui/pagination"
import { SearchField } from "@ren/ui/search-field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Time } from "@ren/ui/time"
import { Toolbar } from "@ren/ui/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Fragment, useDeferredValue, useState } from "react"
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
  const spaceOptions = [
    { value: allSpaces, label: "All spaces" },
    ...spaceItems.map((space) => ({ value: space.id, label: space.name })),
  ]
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
  const pages =
    pageCount <= 7
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [...new Set([1, pageCount, current - 1, current, current + 1])]
          .filter((value) => value >= 1 && value <= pageCount)
          .toSorted((left, right) => left - right)
  const filtered = needle !== "" || spaceId !== allSpaces || state !== "any"
  return (
    <PageShell.Root
      title="Schedules"
      subtitle="Work that starts on a schedule instead of a message."
      toolbar={
        <Toolbar.Root>
          <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search schedules" />
          <Select items={stateOptions} value={state} onValueChange={(next) => next && setState(next)}>
            <SelectTrigger size="sm" aria-label="State">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {stateOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select items={spaceOptions} value={spaceId} onValueChange={(next) => next && setSpaceId(next)}>
            <SelectTrigger size="sm" aria-label="Space">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {spaceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Icon glyph="Plus" data-icon="inline-start" />
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
        {visible.map((schedule) => (
          <ScheduleCard key={schedule.id} schedule={schedule} spaceName={spaceNames.get(schedule.spaceId) ?? "—"} />
        ))}
      </Grid>
      {pageCount > 1 ? (
        <Pagination className="justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                aria-disabled={current <= 1}
                className={current <= 1 ? "pointer-events-none opacity-50" : undefined}
                onClick={() => setPage(current - 1)}
              />
            </PaginationItem>
            {pages.map((value, index) => (
              <Fragment key={value}>
                {value - (pages[index - 1] ?? value - 1) > 1 ? (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : null}
                <PaginationItem>
                  <PaginationLink isActive={value === current} className="tabular-nums" onClick={() => setPage(value)}>
                    {value}
                  </PaginationLink>
                </PaginationItem>
              </Fragment>
            ))}
            <PaginationItem>
              <PaginationNext
                aria-disabled={current >= pageCount}
                className={current >= pageCount ? "pointer-events-none opacity-50" : undefined}
                onClick={() => setPage(current + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
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
  if (props.state === "loading")
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  if (props.state === "failed")
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon glyph="AlertCircle" tone="danger" />
          </EmptyMedia>
          <EmptyTitle>Couldn’t load every schedule.</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  if (props.state === "empty")
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon glyph="Clock" />
          </EmptyMedia>
          <EmptyTitle>{props.filtered ? "No matching schedules" : "No schedules yet"}</EmptyTitle>
          <EmptyDescription>
            {props.filtered
              ? "Try a different search or filter."
              : "Create one to run a prompt on a recurring cadence."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <section aria-label="Schedules" aria-live="polite">
      <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">{props.children}</div>
    </section>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's schedule card: the next run as a relative time, archive, and a switch that pauses or resumes; an ended schedule's switch is off and says why.
function ScheduleCard(props: { schedule: ScheduleInfo; spaceName: string }) {
  const schedule = props.schedule
  const actions = ScheduleActions.useActions(schedule)
  const status = Schedules.statusOf(schedule)
  const ended = schedule.status === "ended"
  const toggle = (
    <Switch
      checked={schedule.status === "active"}
      disabled={ended}
      onCheckedChange={() => actions.toggle?.onSelect()}
      aria-label={`${schedule.status === "active" ? "Pause" : "Resume"} schedule: ${schedule.name}`}
    />
  )
  return (
    <>
      <Card className="relative gap-4 border ring-0 transition-colors hover:bg-muted active:scale-99">
        <CardHeader>
          <div className="mb-3 flex size-12 items-center justify-center rounded-lg bg-secondary">
            <Icon glyph="Clock" size="large" tone="secondary" />
          </div>
          <Link
            to="/schedules/$scheduleId"
            params={{ scheduleId: schedule.id }}
            aria-label={`Open schedule: ${schedule.name}`}
            className="col-span-2 flex min-w-0 flex-col gap-1 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            <CardTitle className="truncate text-sm">{schedule.name}</CardTitle>
            <CardDescription className="line-clamp-2 min-h-8 text-xs">
              {props.spaceName} · <ScheduleWhen when={schedule.when} />
            </CardDescription>
          </Link>
          <CardAction className="relative row-span-1 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Archive schedule: ${schedule.name}`}
              onClick={actions.archive}
            >
              <Icon glyph="Trash2" />
            </Button>
            {ended ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>{toggle}</TooltipTrigger>
                <TooltipContent>It ended. Edit its time to run it again.</TooltipContent>
              </Tooltip>
            ) : (
              toggle
            )}
          </CardAction>
        </CardHeader>
        {schedule.status === "paused" ? null : (
          <CardFooter className="mx-4 mb-4 bg-transparent px-0 pt-3 pb-0 text-xs text-muted-foreground tabular-nums">
            {schedule.nextRunAt ? (
              <Time value={schedule.nextRunAt} format="relative" relativeStyle="narrow" label="Next run" />
            ) : (
              status.label
            )}
          </CardFooter>
        )}
      </Card>
      {actions.dialogs}
    </>
  )
}
