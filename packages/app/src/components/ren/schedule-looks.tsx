import { useState } from "react"
import type { ScheduleInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { IconBolt, IconCube, IconPlayerPlay } from "@tabler/icons-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCard } from "@/components/ren/page"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { RowMenu } from "@/components/ren/row-menu"
import type { Schedules } from "@/hooks/use-schedules"
import { useMembers } from "@/hooks/use-members"
import { api, errorMessage } from "@/lib/api"
import { formatRelative } from "@/lib/format"
import { describe } from "@/lib/schedules"
import { cn } from "@/lib/utils"
import { chooseScheduleLook, useScheduleLook, type ScheduleLook } from "@/stores/ui"

const nameOf = (schedule: ScheduleInfo) => schedule.name || schedule.message

const nextRun = (schedule: ScheduleInfo, now: number) =>
  schedule.status === "active" && schedule.nextRunAt ? formatRelative(schedule.nextRunAt, now) : "—"

function OpenName(props: { schedule: ScheduleInfo; onOpen: () => void; className?: string | undefined }) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className={cn(
        "truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50",
        props.className,
      )}
    >
      {nameOf(props.schedule)}
    </button>
  )
}

function Actions(props: { list: Schedules; schedule: ScheduleInfo; archive?: boolean | undefined }) {
  const active = props.list.isActive(props.schedule)
  return (
    <span className="relative">
      <RowMenu
        label={`${nameOf(props.schedule)} actions`}
        className="flex text-muted-foreground"
        items={[
          ...(props.schedule.status === "ended"
            ? []
            : [{ label: active ? "Pause" : "Resume", onSelect: () => props.list.toggle(props.schedule) }]),
          { label: props.archive ? "Archive" : "Delete", onSelect: () => props.list.setDeleting(props.schedule) },
        ]}
      />
    </span>
  )
}

export function ZapierLook(props: { list: Schedules; schedules: ReadonlyArray<ScheduleInfo> }) {
  const list = props.list
  const people = new Map(useMembers().members.map((member) => [member.id, member]))
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Last modified</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.schedules.map((schedule) => {
          const owner = people.get(schedule.ownerId)
          return (
            <TableRow key={schedule.id} className="relative">
              <TableCell className="max-w-72">
                <span className="flex min-w-0 items-center gap-2">
                  <IconBolt className="size-4 shrink-0 text-chart-3" />
                  <OpenName schedule={schedule} onOpen={() => list.edit(schedule)} />
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <IconCube className="size-4" />
                  {list.spaceName(schedule.spaceId)}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{formatRelative(schedule.updatedAt, list.now)}</TableCell>
              <TableCell>
                <Switch
                  className="relative"
                  checked={list.isActive(schedule)}
                  disabled={schedule.status === "ended"}
                  onCheckedChange={() => list.toggle(schedule)}
                  aria-label={list.isActive(schedule) ? "Turn off" : "Turn on"}
                />
              </TableCell>
              <TableCell>
                {owner ? <PersonAvatar name={owner.name} image={owner.image ?? undefined} /> : null}
              </TableCell>
              <TableCell>
                <Actions list={list} schedule={schedule} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

const tabs = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Completed" },
] as const

export function Base44Look(props: { list: Schedules; schedules: ReadonlyArray<ScheduleInfo> }) {
  const list = props.list
  const [tab, setTab] = useState<string>("active")
  const run = useMutation(api.schedule.run.mutationOptions())
  const rows = props.schedules.filter((schedule) => schedule.status === tab)
  return (
    <TableCard className="flex flex-col gap-2">
      <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="px-2 pt-2">
        <TabsList>
          {tabs.map((each) => (
            <TabsTrigger key={each.value} value={each.value} className="px-2.5 tabular-nums">
              {each.label} ({props.schedules.filter((schedule) => schedule.status === each.value).length})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Schedule</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead className="w-36" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                Nothing here.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((schedule) => (
            <TableRow key={schedule.id} className="relative">
              <TableCell className="text-muted-foreground">{describe(schedule.when, list.zone)}</TableCell>
              <TableCell className="max-w-64">
                <OpenName schedule={schedule} onOpen={() => list.edit(schedule)} />
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{nextRun(schedule, list.now)}</TableCell>
              <TableCell>
                <span className="relative flex items-center justify-end gap-1">
                  {schedule.status === "ended" ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={run.isPending}
                      onClick={() =>
                        run.mutate(
                          { id: schedule.id },
                          {
                            onSuccess: () => toast.success(`${nameOf(schedule)} started`),
                            onError: (error) =>
                              toast.error("Could not run the schedule", { description: errorMessage(error) }),
                          },
                        )
                      }
                    >
                      <IconPlayerPlay data-icon="inline-start" />
                      Run now
                    </Button>
                  )}
                  <Actions list={list} schedule={schedule} archive />
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

const statusBadge = (schedule: ScheduleInfo) =>
  schedule.status === "active" ? (
    <Badge variant="secondary" className="bg-chart-2/15 text-chart-2">
      Active
    </Badge>
  ) : schedule.status === "paused" ? (
    <Badge variant="secondary">Paused</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Ended
    </Badge>
  )

export function DevinLook(props: { list: Schedules; schedules: ReadonlyArray<ScheduleInfo> }) {
  const list = props.list
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.schedules.map((schedule) => (
            <TableRow key={schedule.id} className="relative">
              <TableCell className="max-w-72">
                <OpenName schedule={schedule} onOpen={() => list.edit(schedule)} />
              </TableCell>
              <TableCell className="text-muted-foreground">{describe(schedule.when, list.zone)}</TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{nextRun(schedule, list.now)}</TableCell>
              <TableCell>{statusBadge(schedule)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

const looks: ReadonlyArray<{ value: ScheduleLook; label: string }> = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "zapier", label: "Zapier" },
  { value: "base44", label: "Base44" },
  { value: "devin", label: "Devin" },
]

const isLook = (value: unknown): value is ScheduleLook => looks.some((look) => look.value === value)

export function ScheduleLookSwitcher() {
  const look = useScheduleLook()
  return (
    <Tabs
      value={look}
      onValueChange={(value) => {
        if (isLook(value)) chooseScheduleLook(value)
      }}
      className="fixed top-2.5 left-1/2 z-50 -translate-x-1/2 max-md:hidden"
    >
      <TabsList className="shadow-overlay">
        <span className="px-2 text-xs">Scheduled</span>
        {looks.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="px-2.5 text-xs">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
