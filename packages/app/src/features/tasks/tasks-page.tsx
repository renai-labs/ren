import { EmptyState } from "../../components/empty-state.js"
import { Link, getRouteApi } from "@tanstack/react-router"
import {
  IconAlertCircle,
  IconChevronDown,
  IconCube,
  IconArchive,
  IconLink,
  IconX,
  IconPlus,
  IconGhost,
} from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Checkbox } from "@ren/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { ExpandableSearch } from "../../components/expandable-search.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { Page, SkeletonRows } from "../../components/page.js"
import { NewTaskDialog } from "../../components/new-task-dialog.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { FilterChips, FilterMenu, type Filters } from "../../components/filter-menu.js"
import { DisplayOptions } from "./task-filters.js"
import { countedTaskProperties, taskProperties, matchesFilters, type TaskLookups } from "./task-properties.js"
import {
  LabelBadge,
  PriorityIcon,
  StatusGlyph,
  StatusIcon,
  UnassignedIcon,
  statuses,
} from "../../components/task-meta.js"
import { useMembers, type Member } from "../../lib/use-members.js"
import { formatShortDate } from "@ren/ui/time"
import { cn } from "cn"
import { useState, type ComponentType } from "react"
import type { TaskInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { useAgents } from "../../lib/use-agents.js"
import { useLabels } from "../../lib/use-labels.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { allTasksOptions, taskListInput } from "../../lib/tasks.js"
import { TaskDisplay } from "./task-display.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/tasks/")

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }

type Task = TaskInfo

const idWidths = [
  "w-[0ch]",
  "w-[1ch]",
  "w-[2ch]",
  "w-[3ch]",
  "w-[4ch]",
  "w-[5ch]",
  "w-[6ch]",
  "w-[7ch]",
  "w-[8ch]",
  "w-[9ch]",
  "w-[10ch]",
  "w-[11ch]",
  "w-[12ch]",
  "w-[13ch]",
  "w-[14ch]",
  "w-[15ch]",
  "w-[16ch]",
]

function TaskMeta(props: { task: Task; show: (property: string) => boolean }) {
  const task = props.task
  const show = props.show
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {task.humanReview ? (
        <Badge variant="outline" className="h-6 rounded-full bg-muted">
          <IconAlertCircle />
          Needs review
        </Badge>
      ) : null}
      {show("labels")
        ? task.labels.map((label) => <LabelBadge key={label.id} name={label.name} color={label.color} />)
        : null}
      {show("due") && task.dueAt ? (
        <span className="px-1 text-xs text-muted-foreground">{formatShortDate(task.dueAt)}</span>
      ) : null}
      {show("created") ? (
        <span className="px-1 text-xs text-muted-foreground">{formatShortDate(task.createdAt)}</span>
      ) : null}
      {show("updated") ? (
        <span className="px-1 text-xs text-muted-foreground">{formatShortDate(task.updatedAt)}</span>
      ) : null}
      {show("links") && task.links.length > 0 ? (
        <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
          <IconLink className="size-3.5" />
          {task.links.length}
        </span>
      ) : null}
    </span>
  )
}

function TaskAssignee(props: { task: Task; agentName: string | null; owner: Member | undefined }) {
  if (props.task.agentId)
    return (
      <span className="flex size-6 shrink-0 items-center justify-center">
        <IconGhost className="size-4 text-muted-foreground" aria-label={props.agentName ?? "Agent"} />
      </span>
    )
  return (
    <span className="flex size-6 shrink-0 items-center justify-center">
      {props.owner ? <PersonAvatar name={props.owner.name} image={props.owner.image} /> : <UnassignedIcon />}
    </span>
  )
}

function TaskRow(props: {
  task: Task
  show: ReadonlyArray<string>
  selected: boolean
  idWidth: number
  agentName: string | null
  owner: Member | undefined
  onSelect: (selected: boolean) => void
}) {
  const task = props.task
  const show = (property: string) => props.show.includes(property)
  return (
    <div
      data-selected={props.selected || undefined}
      className="group/row relative flex h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted data-selected:bg-muted"
    >
      <Checkbox
        checked={props.selected}
        onCheckedChange={props.onSelect}
        aria-label={`Select ${task.title}`}
        className="relative z-10 mx-1 size-3.5 border-muted-foreground/70 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 dark:bg-card data-checked:opacity-100 [&_[data-slot=checkbox-indicator]>svg]:size-3"
      />
      {show("priority") ? <PriorityIcon priority={task.priority} /> : null}
      <span
        className={cn(
          "ml-2 min-w-20 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground",
          idWidths[Math.min(props.idWidth, idWidths.length - 1)],
        )}
      >
        {task.identifier}
      </span>
      {show("status") ? <StatusIcon task={task} /> : null}
      <Link
        to="/tasks/$taskId"
        params={{ taskId: task.id }}
        className="ml-2 min-w-0 truncate font-medium after:absolute after:inset-0 after:rounded-lg"
      >
        {task.title}
      </Link>
      <TaskMeta task={task} show={show} />
      {show("assignee") ? <TaskAssignee task={task} agentName={props.agentName} owner={props.owner} /> : null}
    </div>
  )
}

const groupingsFor = (lookups: TaskLookups) => ({
  space: lookups.spaces.map((space) => ({
    id: space.id,
    label: space.name,
    icon: IconCube,
    spaceId: space.id as string | undefined,
    has: (task: Task) => task.spaceId === space.id,
  })),
  status: Object.entries(statuses).map(([value, status]) => ({
    id: value,
    label: status.label,
    icon: (props: { className?: string }) => <StatusGlyph status={value} className={props.className} />,
    spaceId: undefined,
    has: (task: Task) => task.status === value,
  })),
  agent: [
    ...lookups.agents.map((agent) => ({
      id: agent.id,
      label: agent.name,
      icon: IconGhost,
      spaceId: undefined,
      has: (task: Task) => task.agentId === agent.id,
    })),
    {
      id: "none",
      label: "No agent",
      icon: IconGhost,
      spaceId: undefined,
      has: (task: Task) => task.agentId === null,
    },
  ],
})

type TaskGroup = {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<{ className?: string }>
  readonly spaceId: string | undefined
  readonly tasks: ReadonlyArray<Task>
}

function TaskGroups(props: {
  groups: ReadonlyArray<TaskGroup>
  loading: boolean
  stale: boolean
  filtered: boolean
  onClearFilters: () => void
  properties: ReadonlyArray<string>
  idWidth: number
  selected: ReadonlyArray<string>
  onSelect: (selection: { taskId: string; checked: boolean }) => void
}) {
  const agents = useAgents()
  const members = useMembers()
  const groups = props.groups
  if (props.loading) return <SkeletonRows />
  if (groups.length === 0 && props.filtered)
    return (
      <EmptyState
        action={
          <Button variant="outline" onClick={props.onClearFilters}>
            Clear filters
          </Button>
        }
      >
        No tasks match these filters
      </EmptyState>
    )
  if (groups.length === 0)
    return (
      <EmptyState action={<NewTaskDialog trigger={<Button variant="outline" />}>New task</NewTaskDialog>}>
        No tasks yet
      </EmptyState>
    )
  return (
    <div className={cn("flex flex-col transition-opacity", props.stale && "opacity-60")}>
      {groups.map((group) => (
        <Collapsible key={group.id} defaultOpen>
          <div className="flex h-9 items-center gap-2 rounded-lg bg-muted pr-2 pl-1 text-sm">
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground [&_svg]:-rotate-90 aria-expanded:[&_svg]:rotate-0"
                  aria-label={`Toggle ${group.label}`}
                />
              }
            >
              <IconChevronDown className="size-3.5" />
            </CollapsibleTrigger>
            <group.icon className="size-4 text-muted-foreground" />
            <h2 className="truncate font-medium">{group.label}</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{group.tasks.length}</span>
            <NewTaskDialog
              spaceId={group.spaceId}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto text-muted-foreground"
                  aria-label={`New task in ${group.label}`}
                />
              }
            >
              <IconPlus className="size-3.5" />
            </NewTaskDialog>
          </div>
          <CollapsibleContent>
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                show={props.properties}
                idWidth={props.idWidth}
                agentName={agents.agent(task.agentId)?.name ?? null}
                owner={members.member(task.ownerId)}
                selected={props.selected.includes(task.id)}
                onSelect={(checked) => props.onSelect({ taskId: task.id, checked })}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}

export function TasksPage() {
  const { api, client, platform } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tasks = useQuery({
    ...allTasksOptions(client, taskListInput(search)),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const [display, setDisplay] = useState(() => TaskDisplay.preference.read(platform.storage))
  const spaces = useSpaces()
  const agents = useAgents()
  const members = useMembers()
  const labels = useLabels()
  const lookups: TaskLookups = {
    spaces: spaces.spaces,
    agents: agents.agents,
    members: members.members,
    labels,
  }
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [archiving, setArchiving] = useState(false)
  const update = useMutation(api.task.update.mutationOptions())
  const assign = useMutation(api.task.assign.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const filters: Filters = Object.fromEntries(
    Object.entries(search.filters ?? {}).map(([key, values]) => [key, [...values]]),
  )
  const needle = query.trim().toLowerCase()
  const roots: ReadonlyArray<TaskInfo> = tasks.data?.items ?? []
  const order = (a: TaskInfo, b: TaskInfo) => {
    const value =
      display.orderBy === "priority"
        ? (priorityRank[a.priority ?? ""] ?? 3) - (priorityRank[b.priority ?? ""] ?? 3)
        : Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return display.direction === "asc" ? value : -value
  }
  const visible = roots
    .filter((task) => matchesFilters(lookups, task, filters))
    .filter((task) => !needle || `${task.identifier} ${task.title}`.toLowerCase().includes(needle))
    .toSorted(order)
  const bulk = async (ids: ReadonlyArray<string>, run: (id: string) => Promise<unknown>, done: string) => {
    const results = await Promise.allSettled(ids.map(run))
    const failed = results.filter((result) => result.status === "rejected").length
    if (failed > 0) toast.error(`${failed} of ${ids.length} tasks couldn’t be changed`)
    else toast.success(done)
  }
  const loading = tasks.isPending
  const stale = tasks.isPlaceholderData
  const idWidth = Math.max(0, ...roots.map((task) => task.identifier.length)) + 1
  const setFilters = (next: Filters) =>
    void navigate({
      search: (previous) => ({
        ...previous,
        filters: Object.values(next).some((values) => values.length > 0) ? next : undefined,
      }),
    })
  const clearFilters = () => {
    setQuery("")
    void navigate({ search: (previous) => ({ ...previous, filters: undefined }) })
  }
  const setStatus = (status: string) => {
    const ids = selected
    setSelected([])
    if (status !== "todo" && status !== "in_progress" && status !== "done" && status !== "dismissed") return
    void bulk(ids, (id) => update.mutateAsync({ id, status }), "Status changed")
  }
  const move = (agentId: string | null) => {
    const ids = selected
    setSelected([])
    void bulk(ids, (id) => assign.mutateAsync({ id, agentId, start: "none" }), "Tasks moved")
  }
  const archiveSelected = async () => {
    const ids = selected
    setSelected([])
    await bulk(
      ids,
      (id) => archive.mutateAsync({ id }),
      ids.length === 1 ? "Task archived" : `${ids.length} tasks archived`,
    )
  }
  const groupings = groupingsFor(lookups)
  const grouping =
    display.groupBy === "status" || display.groupBy === "agent" ? groupings[display.groupBy] : groupings.space
  const groups = grouping
    .map((group) => ({
      id: group.id,
      label: group.label,
      icon: group.icon,
      spaceId: group.spaceId,
      tasks: visible.filter(group.has),
    }))
    .filter((group) => display.showEmpty || group.tasks.length > 0)
  return (
    <Page
      title="Tasks"
      width="full"
      leading={<FilterChips properties={taskProperties(lookups)} value={filters} onChange={setFilters} />}
      actions={
        <>
          <ExpandableSearch label="Search tasks" value={query} onChange={setQuery} />
          <FilterMenu
            label="Filter tasks"
            properties={countedTaskProperties(lookups, roots)}
            value={filters}
            onChange={setFilters}
            noun="task"
          />
          <DisplayOptions
            value={display}
            onChange={(next: TaskDisplay.Display) => {
              TaskDisplay.preference.write(platform.storage, next)
              setDisplay(next)
            }}
          />
          <NewTaskDialog trigger={<Button />}>
            <IconPlus data-icon="inline-start" />
            New task
          </NewTaskDialog>
        </>
      }
    >
      <TaskGroups
        groups={groups}
        loading={loading}
        stale={stale}
        filtered={visible.length < roots.length}
        onClearFilters={clearFilters}
        properties={display.properties}
        idWidth={idWidth}
        selected={selected}
        onSelect={({ taskId, checked }) =>
          setSelected((current) => (checked ? [...current, taskId] : current.filter((id) => id !== taskId)))
        }
      />
      <SelectionBar
        count={selected.length}
        agents={lookups.agents}
        onStatus={setStatus}
        onMove={move}
        onArchive={() => setArchiving(true)}
        onClear={() => setSelected([])}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        confirmation={
          selected.length === 1
            ? {
                title: "Archive task?",
                description: `“${roots.find((task) => task.id === selected.at(0))?.title ?? "This task"}” will be removed from Tasks.`,
                action: "Archive",
              }
            : {
                title: `Archive ${selected.length} tasks?`,
                description: "These tasks will be removed from Tasks.",
                action: "Archive",
              }
        }
        onConfirm={archiveSelected}
      />
    </Page>
  )
}

function SelectionBar(props: {
  count: number
  agents: TaskLookups["agents"]
  onStatus: (status: string) => void
  onMove: (agentId: string | null) => void
  onArchive: () => void
  onClear: () => void
}) {
  if (props.count === 0) return null
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the floating selection bar is a landmark without a heading
      role="region"
      aria-label="Selected tasks"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-popover p-1 text-sm shadow-overlay md:left-[calc(50%+var(--sidebar-width)/2)]"
    >
      <span className="flex h-7 items-center rounded-md border border-dashed px-2 text-xs">
        {props.count} selected
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          onClick={props.onClear}
          className="-mr-1 ml-1 size-5 rounded-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
        >
          <IconX />
        </Button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Change status</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-48">
          <DropdownMenuGroup>
            {Object.entries(statuses).map(([value, status]) => (
              <DropdownMenuItem key={value} onClick={() => props.onStatus(value)}>
                <StatusGlyph status={value} />
                {status.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Move</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          <DropdownMenuGroup>
            {props.agents.map((agent) => (
              <DropdownMenuItem key={agent.id} onClick={() => props.onMove(agent.id)}>
                <IconGhost />
                {agent.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => props.onMove(null)}>
              <UnassignedIcon />
              No agent
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={props.onArchive}>
        <IconArchive />
        Archive
      </Button>
    </div>
  )
}
