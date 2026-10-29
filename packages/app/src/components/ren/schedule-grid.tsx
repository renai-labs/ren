import type { ScheduleInfo } from "@ren/client"
import {
  IconActivity,
  IconClock,
  IconCube,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRepeat,
  IconTrash,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { EmptyState } from "@/components/ren/empty-state"
import { ExpandableSearch } from "@/components/ren/expandable-search"
import { FilterMenu, type FilterProperty } from "@/components/ren/filter-menu"
import { SkeletonRows } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { Base44Look, DevinLook, ZapierLook } from "@/components/ren/schedule-looks"
import { ScheduleSheet } from "@/components/ren/schedule-sheet"
import type { Schedules } from "@/hooks/use-schedules"
import { describe, statusOf } from "@/lib/schedules"
import { cn } from "@/lib/utils"
import { useScheduleLook } from "@/stores/ui"

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

const sections = [
  { status: "active", title: "Active" },
  { status: "paused", title: "Paused" },
  { status: "ended", title: "Ended" },
] as const

export function ScheduleGrid(props: { list: Schedules }) {
  const list = props.list
  const schedules = list.schedules
  const empty = schedules?.length === 0
  const look = useScheduleLook()
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
      {schedules && !empty && look !== "chatgpt" ? (
        <div className={cn("transition-opacity", list.stale && "opacity-60")}>
          {look === "zapier" ? <ZapierLook list={list} schedules={schedules} /> : null}
          {look === "base44" ? <Base44Look list={list} schedules={schedules} /> : null}
          {look === "devin" ? <DevinLook list={list} schedules={schedules} /> : null}
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-10 transition-opacity",
          list.stale && "opacity-60",
          look !== "chatgpt" && "hidden",
        )}
      >
        {sections.map((section) => {
          const rows = (schedules ?? []).filter((schedule) => schedule.status === section.status)
          if (rows.length === 0) return null
          return (
            <section key={section.status} aria-label={section.title} className="flex flex-col">
              <h2 className="border-b pb-3 text-sm font-medium">{section.title}</h2>
              <ul className="flex flex-col divide-y">
                {rows.map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    space={list.spaceId ? undefined : list.spaceName(schedule.spaceId)}
                    cadence={describe(schedule.when, list.zone)}
                    status={statusOf(schedule, list.now)}
                    active={list.isActive(schedule)}
                    onOpen={() => list.edit(schedule)}
                    onToggle={() => list.toggle(schedule)}
                    onDelete={() => list.setDeleting(schedule)}
                  />
                ))}
              </ul>
            </section>
          )
        })}
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

function ScheduleRow(props: {
  schedule: ScheduleInfo
  space: string | undefined
  cadence: string
  status: string
  active: boolean
  onOpen: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const schedule = props.schedule
  const ended = schedule.status === "ended"
  return (
    <li className="group/row relative flex h-12 items-center gap-3 px-1 transition-colors duration-150 ease-out hover:bg-muted/40">
      <IconClock className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <button
          type="button"
          onClick={props.onOpen}
          title={props.status}
          className={cn(
            "truncate text-left text-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50",
            !props.active && "text-muted-foreground",
          )}
        >
          {schedule.name || schedule.message}
        </button>
        {props.space ? <span className="shrink-0 truncate text-xs text-muted-foreground">{props.space}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {props.active ? <IconRepeat className="size-3.5" /> : null}
        {props.active ? props.cadence : props.status}
      </span>
      <span className="relative w-7 shrink-0 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100">
        <RowMenu
          label={`${schedule.name} actions`}
          className="flex text-muted-foreground"
          items={[
            ...(ended
              ? []
              : [
                  {
                    label: props.active ? "Pause" : "Resume",
                    icon: props.active ? <IconPlayerPause /> : <IconPlayerPlay />,
                    onSelect: props.onToggle,
                  },
                ]),
            { label: "Delete", icon: <IconTrash />, onSelect: props.onDelete },
          ]}
        />
      </span>
    </li>
  )
}
