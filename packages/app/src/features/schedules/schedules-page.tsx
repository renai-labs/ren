import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
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
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { Fragment, useDeferredValue, useState } from "react"
import { ScheduleDialog } from "../../components/schedule-dialog.js"
import { RouterContext } from "../../lib/router-context.js"
import { ScheduleQueries } from "./schedule-queries.js"
import { SchedulesGrid } from "./schedules-grid.js"

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
    <Page.Root
      title="Schedules"
      description="Work that starts on a schedule instead of a message."
      actions={
        <>
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
        </>
      }
      footer={
        pageCount > 1 ? (
          <Pagination className="mx-0 ml-auto w-auto justify-end">
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
                    <PaginationLink
                      isActive={value === current}
                      className="tabular-nums"
                      onClick={() => setPage(value)}
                    >
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
        ) : undefined
      }
    >
      <SchedulesGrid
        status={schedules.status}
        schedules={visible}
        spaceNames={spaceNames}
        pageCount={pageCount}
        filtered={filtered}
        spaceCount={spaceItems.length}
        onRetry={() => void schedules.refetch()}
        onCreate={() => setCreating(true)}
        onClearFilters={() => {
          setQuery("")
          setSpaceId(allSpaces)
          setState("any")
        }}
      />
      {creating ? <ScheduleDialog onClose={() => setCreating(false)} /> : null}
    </Page.Root>
  )
}
