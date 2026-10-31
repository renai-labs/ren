import type { ScheduleInfo } from "@ren/client"
import { IconActivity, IconClock, IconCube, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ConfirmDialog } from "./confirm-dialog.js"
import { EmptyState } from "./empty-state.js"
import { ExpandableSearch } from "./expandable-search.js"
import { FilterMenu, type FilterProperty } from "./filter-menu.js"
import { SkeletonRows, TableCard } from "./page.js"
import { RowMenu } from "./row-menu.js"
import { ScheduleSheet } from "./schedule-sheet.js"
import type { Schedules } from "../lib/use-schedules.js"
import { formatRelative } from "@ren/ui/time"
import { describe, statusOf } from "../lib/schedules.js"
import { cn } from "cn"

export function ScheduleToolbar(props: { list: Schedules }) {
  const list = props.list
  const state: FilterProperty = {
    key: "state",
    label: "State",
    any: "Any",
    icon: IconActivity,
    single: true,
    options: [
      { value: "active", label: "Active" },
      { value: "paused", label: "Paused" },
    ],
  }
  const space: FilterProperty = {
    key: "space",
    label: "Space",
    any: "All spaces",
    icon: IconCube,
    single: true,
    options: list.spaces.map((each) => ({ value: each.id, label: each.name })),
  }
  return (
    <>
      <ExpandableSearch label="Search schedules" value={list.query} onChange={list.setQuery} />
      <FilterMenu
        label="Filter schedules"
        properties={list.spaceId ? [state] : [state, space]}
        value={list.filters}
        onChange={list.setFilters}
      />
      <Button onClick={list.create}>
        <IconPlus data-icon="inline-start" />
        Create schedule
      </Button>
    </>
  )
}

const nextRun = (schedule: ScheduleInfo, now: number) =>
  schedule.status === "active" && schedule.nextRunAt ? formatRelative(schedule.nextRunAt, now) : "—"

function stateLabel(schedule: ScheduleInfo, now: number) {
  if (schedule.status === "active") return "Running on schedule"
  if (schedule.status === "ended") return "Ended"
  return statusOf(schedule, now)
}

function ScheduleRow(props: { list: Schedules; schedule: ScheduleInfo }) {
  const list = props.list
  const schedule = props.schedule
  const active = list.isActive(schedule)
  const space = list.spaceId ? undefined : list.spaceName(schedule.spaceId)
  return (
    <TableRow className="relative">
      <TableCell className="max-w-72">
        <span className="flex min-w-0 items-start gap-2.5">
          <IconClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <Button
              variant="ghost"
              onClick={() => list.edit(schedule)}
              className={cn(
                "block h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 text-left font-normal after:absolute after:inset-0 hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none",
                !active && "text-muted-foreground",
              )}
            >
              {schedule.name || schedule.message}
            </Button>
            {space ? <span className="truncate text-xs text-muted-foreground">{space}</span> : null}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{describe(schedule.when, list.zone)}</TableCell>
      <TableCell className="text-muted-foreground tabular-nums">{nextRun(schedule, list.now)}</TableCell>
      <TableCell>
        <span className="relative flex items-center gap-2">
          <Switch
            checked={active}
            disabled={schedule.status === "ended"}
            onCheckedChange={() => list.toggle(schedule)}
            aria-label={active ? `Turn off ${schedule.name}` : `Turn on ${schedule.name}`}
            title={stateLabel(schedule, list.now)}
          />
        </span>
      </TableCell>
      <TableCell>
        <span className="relative flex justify-end">
          <RowMenu
            label={`${schedule.name} actions`}
            className="flex text-muted-foreground"
            items={[
              { label: "Edit", icon: <IconPencil />, onSelect: () => list.edit(schedule) },
              { label: "Delete", icon: <IconTrash />, onSelect: () => list.setDeleting(schedule) },
            ]}
          />
        </span>
      </TableCell>
    </TableRow>
  )
}

export function ScheduleGrid(props: { list: Schedules }) {
  const list = props.list
  const schedules = list.schedules
  const empty = schedules?.length === 0
  return (
    <>
      {schedules ? null : <SkeletonRows count={4} />}
      {empty && list.filtered ? (
        <EmptyState title="No matching schedules">Try a different search or filter.</EmptyState>
      ) : null}
      {empty && !list.filtered ? (
        <EmptyState title="No schedules yet">Create one to run a prompt on a recurring cadence.</EmptyState>
      ) : null}
      {schedules && !empty ? (
        <TableCard className={cn("transition-opacity", list.stale && "opacity-60")}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((schedule) => (
                <ScheduleRow key={schedule.id} list={list} schedule={schedule} />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
      <ScheduleSheet
        open={list.sheet.open}
        version={list.sheet.key}
        schedule={list.sheet.schedule}
        spaceId={list.spaceId}
        onClose={list.closeSheet}
      />
      {list.deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) list.setDeleting(undefined)
          }}
          confirmation={{
            title: "Delete schedule?",
            description: "It stops running. Chats it already started stay.",
            action: "Delete",
          }}
          onConfirm={() => (list.deleting ? list.remove(list.deleting) : undefined)}
        />
      ) : null}
    </>
  )
}
