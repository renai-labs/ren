import type { ScheduleInfo } from "@ren/client"
import { IconActivity, IconClock, IconCube, IconPlus, IconTrash } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { EmptyState } from "@/components/ren/empty-state"
import { ExpandableSearch } from "@/components/ren/expandable-search"
import { FilterMenu, type FilterProperty } from "@/components/ren/filter-menu"
import { SkeletonCards } from "@/components/ren/page"
import { ScheduleSheet } from "@/components/ren/schedule-sheet"
import type { Schedules } from "@/hooks/use-schedules"
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
      <Button size="sm" onClick={list.create}>
        <IconPlus data-icon="inline-start" />
        Create schedule
      </Button>
    </>
  )
}

export function ScheduleGrid(props: { list: Schedules }) {
  const list = props.list
  const empty = list.schedules?.length === 0
  return (
    <>
      {list.schedules ? null : <SkeletonCards columns={3} />}
      {empty ? (
        list.filtered ? (
          <EmptyState title="No matching schedules">Try a different search or filter.</EmptyState>
        ) : (
          <EmptyState title="No schedules yet">Create one to run a prompt on a recurring cadence.</EmptyState>
        )
      ) : null}
      <div
        className={cn(
          "mt-4 grid gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3",
          list.stale && "opacity-60",
          (!list.schedules || empty) && "hidden",
        )}
      >
        {(list.schedules ?? []).map((schedule) => (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            details={[list.spaceName(schedule.spaceId), describe(schedule.when, list.zone)].filter(Boolean).join(" · ")}
            status={statusOf(schedule, list.now)}
            active={list.isActive(schedule)}
            onOpen={() => list.edit(schedule)}
            onToggle={() => list.toggle(schedule)}
            onDelete={() => list.setDeleting(schedule)}
          />
        ))}
      </div>
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

function ScheduleCard(props: {
  schedule: ScheduleInfo
  details: string
  status: string
  active: boolean
  onOpen: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const schedule = props.schedule
  return (
    <Card className="relative gap-4 border shadow-soft ring-0 transition-colors [--card-spacing:--spacing(6)] hover:bg-muted active:scale-99">
      <CardHeader>
        <div className="mb-3 flex size-12 items-center justify-center rounded-lg bg-secondary">
          <IconClock className="size-8 text-muted-foreground" strokeWidth={1.75} />
        </div>
        <CardTitle className="col-span-2 min-w-0 text-sm/5">
          <button
            type="button"
            onClick={props.onOpen}
            aria-label={`Edit schedule: ${schedule.name}`}
            className="block w-full truncate text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {schedule.message}
          </button>
        </CardTitle>
        <CardDescription className="col-span-2 line-clamp-2 min-h-8 min-w-0 text-xs">{props.details}</CardDescription>
        <CardAction className="relative row-span-1 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Delete schedule"
            onClick={props.onDelete}
          >
            <IconTrash />
          </Button>
          <Switch
            checked={props.active}
            disabled={schedule.status === "ended"}
            onCheckedChange={props.onToggle}
            aria-label={props.active ? "Pause schedule" : "Resume schedule"}
          />
        </CardAction>
      </CardHeader>
      <CardFooter className="mx-6 mb-6 bg-transparent px-0 pt-3 pb-0 text-xs text-muted-foreground tabular-nums">
        {props.status}
      </CardFooter>
    </Card>
  )
}
