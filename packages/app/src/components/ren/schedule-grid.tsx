import type { ScheduleInfo } from "@ren/client"
import { IconActivity, IconClock, IconCube, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { EmptyState } from "@/components/ren/empty-state"
import { ExpandableSearch } from "@/components/ren/expandable-search"
import { FilterMenu, type FilterProperty } from "@/components/ren/filter-menu"
import { SkeletonRows, TableCard } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { ScheduleSheet } from "@/components/ren/schedule-sheet"
import type { Schedules } from "@/hooks/use-schedules"
import { formatRelative } from "@/lib/format"
import { describe, statusOf } from "@/lib/schedules"
import { cn } from "@/lib/utils"

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

const stateLabel = (schedule: ScheduleInfo, now: number) =>
  schedule.status === "active" ? "Running on schedule" : schedule.status === "ended" ? "Ended" : statusOf(schedule, now)

export function ScheduleGrid(props: { list: Schedules }) {
  const list = props.list
  const schedules = list.schedules
  const empty = schedules?.length === 0
  return (
    <>
      {schedules ? null : <SkeletonRows count={4} />}
      {empty ? (
        list.filtered ? (
          <EmptyState title="No matching schedules">Try a different search or filter.</EmptyState>
        ) : (
          <EmptyState title="No schedules yet">Create one to run a prompt on a recurring cadence.</EmptyState>
        )
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
              {schedules.map((schedule) => {
                const active = list.isActive(schedule)
                const space = list.spaceId ? undefined : list.spaceName(schedule.spaceId)
                return (
                  <TableRow key={schedule.id} className="relative">
                    <TableCell className="max-w-72">
                      <span className="flex min-w-0 items-start gap-2.5">
                        <IconClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <button
                            type="button"
                            onClick={() => list.edit(schedule)}
                            className={cn(
                              "truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50",
                              !active && "text-muted-foreground",
                            )}
                          >
                            {schedule.name || schedule.message}
                          </button>
                          {space ? <span className="truncate text-xs text-muted-foreground">{space}</span> : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{describe(schedule.when, list.zone)}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{nextRun(schedule, list.now)}</TableCell>
                    <TableCell>
                      <span className="relative flex items-center gap-2">
                        <Switch
                          className="data-checked:bg-ring *:data-checked:bg-white!"
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
              })}
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
