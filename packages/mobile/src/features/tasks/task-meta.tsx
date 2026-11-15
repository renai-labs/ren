import type { TaskInfo } from "@ren/client"
import { Task } from "@ren/schema/task"
import { ErrorText } from "@ren/util/error-text"
import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import IconLineDashed from "@tabler/icons-react-native/IconLineDashed"
import { useQueries, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { Schema } from "effect"
import { useId } from "react"
import { Alert, View } from "react-native"
import Svg, { Circle, Mask, Path, Rect, type NumberProp, type SvgProps } from "react-native-svg"
import { Avatar } from "#components/avatar"
import { Icon } from "#components/icon"
import { Api } from "#lib/api"
import { Preferences } from "#lib/preferences"

type GlyphProps = SvgProps & { size?: NumberProp }

const glyph = (props: GlyphProps) => ({ size: props.size ?? 16, color: props.color ?? "currentColor" })

const nonWord = /\W/gu

const checkPath = "M4 7.2 5.9 9.1 10 5"
const crossPath = "M4.75 4.75 9.25 9.25M9.25 4.75 4.75 9.25"

function ClosedRing(props: GlyphProps & { readonly path: string }) {
  const shown = glyph(props)
  const mask = `ring${useId().replace(nonWord, "")}`
  return (
    <Svg viewBox="-1 -1 16 16" width={shown.size} height={shown.size}>
      <Mask id={mask}>
        <Circle cx="7" cy="7" r="7" fill="white" />
        <Path
          d={props.path}
          fill="none"
          stroke="black"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Mask>
      <Circle cx="7" cy="7" r="7" fill={shown.color} mask={`url(#${mask})`} />
    </Svg>
  )
}

const halfDash = Math.PI * 2

function OpenRing(props: GlyphProps & { readonly half: boolean }) {
  const shown = glyph(props)
  return (
    <Svg viewBox="-1 -1 16 16" width={shown.size} height={shown.size}>
      <Circle cx="7" cy="7" r="6" fill="none" stroke={shown.color} strokeWidth="1.5" />
      {props.half ? (
        <Circle
          cx="7"
          cy="7"
          r="2"
          fill="none"
          stroke={shown.color}
          strokeWidth="4"
          strokeDasharray={`${halfDash} ${halfDash * 2}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}
    </Svg>
  )
}

function TodoRing(props: GlyphProps) {
  return <OpenRing {...props} half={false} />
}

function ProgressRing(props: GlyphProps) {
  return <OpenRing {...props} half />
}

function DoneRing(props: GlyphProps) {
  return <ClosedRing {...props} path={checkPath} />
}

function DismissedRing(props: GlyphProps) {
  return <ClosedRing {...props} path={crossPath} />
}

const statusLooks = {
  todo: { glyph: TodoRing, color: "text-muted-foreground" },
  in_progress: { glyph: ProgressRing, color: "text-chart-3" },
  done: { glyph: DoneRing, color: "text-chart-6" },
  dismissed: { glyph: DismissedRing, color: "text-muted-foreground" },
} as const

function StatusGlyph(props: { readonly status: Task.Status; readonly className?: string }) {
  const look = statusLooks[props.status]
  return (
    <Icon
      as={look.glyph}
      aria-label={Task.statusLabels[props.status]}
      className={cn("size-4", look.color, props.className)}
    />
  )
}

const bars = [
  { x: 1.5, y: 8, height: 6 },
  { x: 6.5, y: 5, height: 9 },
  { x: 11.5, y: 2, height: 12 },
]

function SignalBars(props: GlyphProps & { readonly level: number }) {
  const shown = glyph(props)
  return (
    <Svg viewBox="0 0 16 16" width={shown.size} height={shown.size}>
      {bars.map((bar, index) => (
        <Rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="3"
          height={bar.height}
          rx="1"
          fill={shown.color}
          opacity={index < props.level ? 1 : 0.35}
        />
      ))}
    </Svg>
  )
}

function LowBars(props: GlyphProps) {
  return <SignalBars {...props} level={1} />
}

function MediumBars(props: GlyphProps) {
  return <SignalBars {...props} level={2} />
}

function HighBars(props: GlyphProps) {
  return <SignalBars {...props} level={3} />
}

const priorityGlyphs = { low: LowBars, medium: MediumBars, high: HighBars } as const

function PriorityIcon(props: { readonly priority: Task.Priority | null; readonly className?: string }) {
  return (
    <Icon
      as={props.priority ? priorityGlyphs[props.priority] : IconLineDashed}
      aria-label={props.priority ? Task.priorityLabels[props.priority] : "No priority"}
      className={cn("size-4 text-muted-foreground", props.className)}
    />
  )
}

function DashedPerson(props: GlyphProps) {
  const shown = glyph(props)
  return (
    <Svg viewBox="0 0 16 16" width={shown.size} height={shown.size}>
      <Circle
        cx="8"
        cy="8"
        r="7.1"
        fill="none"
        stroke={shown.color}
        strokeWidth="1.3"
        strokeDasharray="2.2 1.6"
        strokeLinecap="round"
      />
      <Circle cx="8" cy="6.6" r="2.2" fill={shown.color} />
      <Path
        d="M4.4 12.4a4.3 4.3 0 0 1 7.2 0"
        fill="none"
        stroke={shown.color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  )
}

function UnassignedIcon(props: { readonly className?: string }) {
  return (
    <Icon as={DashedPerson} aria-label="Unassigned" className={cn("size-4 text-muted-foreground", props.className)} />
  )
}

function TaskAssignee(props: { readonly task: TaskInfo; readonly owner: Member | undefined }) {
  if (props.task.agentId)
    return <Icon as={IconGhostFilled} aria-label="Agent" className="size-4 text-muted-foreground" />
  if (props.owner) return <Avatar size="sm" name={props.owner.name} />
  return <UnassignedIcon />
}

function LabelDot(props: { readonly color: string | null }) {
  return (
    <View
      className="size-2 rounded-full bg-muted-foreground"
      // oxlint-disable-next-line react/forbid-component-props -- a label's colour is user data, not a theme token
      style={props.color ? { backgroundColor: props.color } : undefined}
    />
  )
}

interface Member {
  readonly id: string
  readonly name: string
}

const pickerPage = { page: 1, pageSize: 100 } as const

function useTaskLookups(spaceIds: ReadonlyArray<string>) {
  const spaces = useQuery(Api.query.space.list.queryOptions(pickerPage)).data?.items ?? []
  const agents = useQuery(Api.query.agent.list.queryOptions({ ...pickerPage, isSubagent: false })).data?.items ?? []
  const labels = useQuery(Api.query.label.list.queryOptions(pickerPage)).data?.items ?? []
  const members = useQueries({
    queries: [...new Set(spaceIds)].map((spaceId) =>
      Api.query["space-member"].list.queryOptions({ ...pickerPage, spaceId, status: "active" }),
    ),
    combine: (results) =>
      results
        .flatMap((result) => result.data?.items ?? [])
        .flatMap((member) =>
          member.status === "active" ? [{ id: member.userId, name: member.name || member.email }] : [],
        ),
  })
  const unique = [...new Map(members.map((member) => [member.id, member])).values()]
  return {
    spaces,
    joined: spaces.filter((space) => Boolean(space.membershipId)),
    agents,
    labels,
    members: unique,
    space: (spaceId: string | null) => spaces.find((space) => space.id === spaceId),
    spaceName: (spaceId: string) => spaces.find((space) => space.id === spaceId)?.name ?? "Space",
    agent: (agentId: string | null) => agents.find((agent) => agent.id === agentId),
    member: (userId: string | null) => unique.find((member) => member.id === userId),
  }
}

type TaskLookups = ReturnType<typeof useTaskLookups>

const Display = Schema.Struct({
  groupBy: Schema.Literals(["status", "space", "agent"]),
  orderBy: Schema.Literals(["created", "priority"]),
  direction: Schema.Literals(["asc", "desc"]),
  showEmpty: Schema.Boolean,
  filters: Schema.Record(Schema.String, Schema.Array(Schema.String)),
})

type Display = typeof Display.Type

const displayDefaults: Display = {
  groupBy: "status",
  orderBy: "created",
  direction: "desc",
  showEmpty: false,
  filters: {},
}

const displayPreference = Preferences.make("tasks.display.v1", Display, displayDefaults)

const statusOptions = Task.Status.literals.map((status) => ({
  value: status,
  label: Task.statusLabels[status],
  icon: <StatusGlyph status={status} />,
}))

const priorityOptions = [
  { value: "none", label: "No priority", icon: <PriorityIcon priority={null} /> },
  ...Task.Priority.literals.toReversed().map((priority) => ({
    value: priority,
    label: Task.priorityLabels[priority],
    icon: <PriorityIcon priority={priority} />,
  })),
]

const isStatus = (value: string): value is Task.Status => Task.Status.literals.some((status) => status === value)

const isPriority = (value: string): value is Task.Priority =>
  Task.Priority.literals.some((priority) => priority === value)

const failed = (title: string) => (cause: unknown) => Alert.alert(title, ErrorText.of(cause))

const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

const formatShortDate = (value: string) => shortDate.format(new Date(value))

const dueChoices = [
  { value: "0", label: "Today" },
  { value: "1", label: "Tomorrow" },
  { value: "7", label: "Next week" },
]

const dueAt = (days: string) => {
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() + Number(days))
  return day.toISOString()
}

const dueOptions = (current: string | null) => [
  ...dueChoices,
  ...(current ? [{ value: "clear", label: "Clear due date" }] : []),
]

export {
  displayDefaults,
  displayPreference,
  dueAt,
  dueOptions,
  failed,
  formatShortDate,
  isPriority,
  isStatus,
  LabelDot,
  PriorityIcon,
  priorityOptions,
  StatusGlyph,
  statusOptions,
  TaskAssignee,
  useTaskLookups,
  type Display,
  type Member,
  type TaskLookups,
}
