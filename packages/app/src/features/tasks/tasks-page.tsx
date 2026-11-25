import { Preference } from "../../lib/preference.js"
import { EmptyState } from "../../components/empty-state.js"
import { IconAlertTriangle, IconArchive, IconCube, IconPlus, IconTag, IconX } from "@tabler/icons-react"
import { IconAgent } from "../../icons/heroicons.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent } from "@ren/ui/collapsible"
import { GroupHeader } from "../../components/group-header.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { TasksSample } from "../../components/route-skeleton.js"
import { Page, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { NewTaskDialog } from "../../components/new-task-dialog.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { FilterChips, FilterMenu, sameFilters } from "../../components/filter-menu.js"
import { DisplayOptions } from "./task-filters.js"
import { TaskBoard } from "./task-board.js"
import { errorMessage } from "../../lib/errors.js"
import { countedTaskProperties, taskProperties, type TaskLookups } from "./task-properties.js"
import {
  PriorityIcon,
  StatusGlyph,
  UnassignedIcon,
  labelColor,
  priorityLabelOf,
  statuses,
} from "../../components/task-meta.js"
import { ColorDot } from "@ren/ui/color-dot"
import type { Assignee } from "../../components/assignee.js"
import { useMembers } from "../../lib/use-members.js"
import { cn } from "cn"
import { Keyboard } from "../../platform/keyboard.js"
import { useState, type ComponentType } from "react"
import type { TaskInfo } from "@ren/client"
import { Debounce, Tasks } from "@ren/client/react"
import { FilterMatch } from "@ren/util/filter-match"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { useAgents } from "../../lib/use-agents.js"
import { useLabels } from "../../lib/use-labels.js"
import { useSpaces } from "../../lib/use-spaces.js"
import type { TaskSearch } from "../../lib/tasks.js"
import { useMe } from "../../lib/use-me.js"
import { TaskViewTabs } from "./task-views.js"
import { useTaskView } from "./use-task-view.js"
import { TaskDisplay } from "./task-display.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"
import { TaskRow } from "./task-row.js"
import { TaskView } from "./task-view.js"

const isStatus = (value: string): value is TaskInfo["status"] => Object.hasOwn(statuses, value)

const priorityValues: ReadonlyArray<NonNullable<TaskInfo["priority"]>> = ["high", "medium", "low"]

type Task = TaskInfo

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
      icon: IconAgent,
      spaceId: undefined,
      has: (task: Task) => task.agentId === agent.id,
    })),
    {
      id: "none",
      label: "No agent",
      icon: IconAgent,
      spaceId: undefined,
      has: (task: Task) => task.agentId === null,
    },
  ],
  label: [
    ...lookups.labels.map((label) => ({
      id: label.name,
      label: label.name,
      icon: IconTag,
      spaceId: undefined,
      has: (task: Task) => task.labels.some((each) => each.name.toLowerCase() === label.name.toLowerCase()),
    })),
    {
      id: "none",
      label: "No label",
      icon: IconTag,
      spaceId: undefined,
      has: (task: Task) => task.labels.length === 0,
    },
  ],
})

type TaskGroup = {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<{ className?: string }>
  readonly spaceId: string | undefined
  readonly tasks: ReadonlyArray<Task>
  readonly branches?: ReadonlyMap<string, Tasks.Branch> | undefined
}

function TaskGroups(props: {
  groups: ReadonlyArray<TaskGroup>
  spaceId: string | undefined
  loading: boolean
  stale: boolean
  filtered: boolean
  query: string
  filtersOn: boolean
  onClearFilters: () => void
  properties: ReadonlyArray<string>
  idWidth: number
  selected: ReadonlyArray<string>
  onSelect: (selection: { taskId: string; checked: boolean }) => void
}) {
  const agents = useAgents()
  const members = useMembers()
  const spaces = useSpaces()
  const groups = props.groups
  const search = props.query.trim()
  const empty = groups.every((group) => group.tasks.length === 0)
  if (props.loading) return <TasksSample />
  if (empty && (props.filtered || props.filtersOn))
    return (
      <EmptyState
        action={
          <Button variant="outline" onClick={props.onClearFilters}>
            {props.filtersOn ? "Clear filters" : "Clear search"}
          </Button>
        }
      >
        {search ? `No tasks match “${search}”` : "No tasks match these filters"}
      </EmptyState>
    )
  if (empty)
    return (
      <EmptyState
        action={
          <NewTaskDialog spaceId={props.spaceId} trigger={<Button variant="outline" />}>
            New task
          </NewTaskDialog>
        }
      >
        No tasks yet
      </EmptyState>
    )
  return (
    <div className={cn("@container/tasks flex flex-col transition-opacity", props.stale && "opacity-60")}>
      {groups.map((group) => (
        <Collapsible key={group.id} defaultOpen>
          <GroupHeader
            label={group.label}
            icon={group.icon}
            count={group.tasks.length}
            action={
              <NewTaskDialog
                spaceId={group.spaceId}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={`New task in ${group.label}`}
                  />
                }
              >
                <IconPlus className="size-3.5" />
              </NewTaskDialog>
            }
          />
          <CollapsibleContent>
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                branch={group.branches?.get(task.id)}
                parent={group.branches?.has(task.id) ? null : task.parent}
                show={props.properties}
                idWidth={props.idWidth}
                agentName={agents.agent(task.agentId)?.name ?? null}
                spaceName={spaces.spaceName(task.spaceId)}
                owner={members.member(task.ownerId)}
                selected={props.selected.includes(task.id)}
                onSelect={props.onSelect}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}

const shapeOf = (text: string, layout: string) =>
  text === "" && layout !== "board" ? ("tree" as const) : ("flat" as const)

const rowsOf = (listed: ReadonlyArray<TaskInfo>, has: (task: TaskInfo) => boolean, shape: "tree" | "flat") => {
  if (shape === "flat") return { tasks: listed.filter(has), branches: undefined }
  const rows = Tasks.nest(Tasks.tops(listed).filter(has), listed)
  return {
    tasks: rows.map((row) => row.task),
    branches: new Map(rows.flatMap((row) => (row.branch ? [[row.task.id, row.branch] as const] : []))),
  }
}

const shownTasks = (tasks: ReadonlyArray<TaskInfo>, text: string, layout: string) =>
  text !== "" || layout !== "board" ? tasks : tasks.filter((task) => !task.parentId)

export function TasksPage(props: {
  search: TaskSearch
  spaceId?: string | undefined
  setSearch: (update: (previous: TaskSearch) => TaskSearch) => void
}) {
  const { api, client, platform } = RouterContext.useRouterContext()
  const search = props.search
  const spaceId = props.spaceId
  const me = useMe()
  const views = useTaskView({
    search,
    spaceId,
    setSearch: (update) => {
      const next = update(search)
      TaskView.remember(platform.storage, spaceId, next)
      props.setSearch(() => next)
    },
  })
  const filters = views.filters
  const [query, setQuery] = useState("")
  const text = Debounce.useValue(query.trim(), 250)
  const tasks = useQuery({
    ...Tasks.all(client, Tasks.treeInput(Tasks.searchInput(Tasks.listInput(filters, spaceId), text))),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const display = Preference.usePreference(TaskDisplay.preference)
  const setPreference = Preference.useSetPreference()
  const spaces = useSpaces()
  const agents = useAgents(spaceId)
  const members = useMembers()
  const labels = useLabels()
  const lookups: TaskLookups = {
    spaces: spaces.spaces,
    agents: agents.agents,
    members: members.members,
    labels,
  }
  const [selected, setSelected] = useState<string[]>([])
  const select = (selection: { taskId: string; checked: boolean }) =>
    setSelected((current) =>
      selection.checked ? [...current, selection.taskId] : current.filter((id) => id !== selection.taskId),
    )
  Keyboard.useKeyDown((event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    if (event.target instanceof Element && event.target.closest("[role=menu],[role=dialog],[role=listbox]")) return
    setSelected((current) => (current.length > 0 ? [] : current))
  })
  const [archiving, setArchiving] = useState(false)
  const update = useMutation(api.task.update.mutationOptions())
  const assign = useMutation(api.task.assign.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const roots: ReadonlyArray<TaskInfo> = tasks.data?.items ?? []
  const visible = Tasks.search(
    roots.filter((task) => FilterMatch.passes(filters, Tasks.filterValues(task, me.user.id))),
    text,
    Tasks.order(display),
  )
  const listed = shownTasks(visible, text, display.layout)
  Keyboard.useKeyDown((event) => {
    if (event.key.toLowerCase() !== "a" || !(event.metaKey || event.ctrlKey) || event.defaultPrevented) return
    if (
      event.target instanceof Element &&
      event.target.closest("input,textarea,[contenteditable=true],[role=menu],[role=dialog]")
    )
      return
    event.preventDefault()
    setSelected(listed.map((task) => task.id))
  })
  const bulk = async (ids: ReadonlyArray<string>, run: (id: string) => Promise<unknown>, done: string) => {
    const results = await Promise.allSettled(ids.map(run))
    const failed = results.filter((result) => result.status === "rejected").length
    if (failed > 0) toast.error(`${failed} of ${ids.length} tasks couldn’t be changed`)
    else toast.success(done)
  }
  const loading = tasks.isPending
  const shapeId = useShapeId(`tasks-${display.layout}`)
  const stale = tasks.isPlaceholderData
  const idWidth = Math.max(0, ...roots.map((task) => task.identifier.length)) + 1
  const clearFilters = () => {
    setQuery("")
    views.setFilters(views.viewFilters)
  }
  const shown = TaskDisplay.scoped(display, spaceId)
  const groupBy = shown.groupBy
  const properties = shown.properties
  const run = (done: string, call: (id: string) => Promise<unknown>) => {
    const ids = selected
    setSelected([])
    void bulk(ids, call, done)
  }
  const namesOf = (id: string) => roots.find((task) => task.id === id)?.labels.map((label) => label.name) ?? []
  const archiveSelected = async () => {
    const ids = selected
    setSelected([])
    await bulk(
      ids,
      (id) => archive.mutateAsync({ id }),
      ids.length === 1 ? "Task archived" : `${ids.length} tasks archived`,
    )
  }
  const moveTo = (input: { taskId: string; groupId: string }) => {
    const failed = (error: unknown) => {
      toast.error("Couldn’t move the task", { description: errorMessage(error) })
    }
    if (groupBy === "status") {
      const status = input.groupId
      return isStatus(status) ? update.mutateAsync({ id: input.taskId, status }).catch(failed) : Promise.resolve()
    }
    if (groupBy === "label") {
      const names = roots.find((task) => task.id === input.taskId)?.labels.map((label) => label.name) ?? []
      const labels = input.groupId === "none" ? [] : [...new Set([...names, input.groupId])]
      return update.mutateAsync({ id: input.taskId, labels }).catch(failed)
    }
    if (groupBy === "agent")
      return assign
        .mutateAsync({ id: input.taskId, agentId: input.groupId === "none" ? null : input.groupId, start: "none" })
        .catch(failed)
    return assign.mutateAsync({ id: input.taskId, spaceId: input.groupId, start: "none" }).catch(failed)
  }
  const groupings = groupingsFor(lookups)
  const shape = shapeOf(text, display.layout)
  const grouping = Object.entries(groupings).find((entry) => entry[0] === groupBy)?.[1] ?? groupings.space
  const groups = grouping
    .map((group) => {
      const rows = rowsOf(listed, group.has, shape)
      return {
        id: group.id,
        label: group.label,
        icon: group.icon,
        spaceId: group.spaceId ?? spaceId,
        tasks: rows.tasks,
        branches: rows.branches,
      }
    })
    .filter((group) => display.showEmpty || group.tasks.length > 0)
  const empty = groups.every((group) => group.tasks.length === 0)
  return (
    <Page
      title="Tasks"
      width="full"
      shape={`page-${display.layout}`}
      tabs={<TaskViewTabs state={views} />}
      leading={
        <FilterChips
          properties={taskProperties(lookups).filter((property) => !spaceId || property.key !== "space")}
          value={TaskView.extrasOf(filters, views.viewFilters)}
          onChange={(extras) => views.setFilters(TaskView.withExtras(views.viewFilters, extras))}
        />
      }
      actions={
        <>
          <ToolbarSearch label="Search tasks" value={query} onChange={setQuery} />
          <FilterMenu
            label="Filter tasks"
            properties={countedTaskProperties(lookups, roots, me.user.id).filter(
              (property) => !spaceId || property.key !== "space",
            )}
            value={filters}
            defaults={views.viewFilters}
            onChange={views.setFilters}
            noun="task"
          />
          <DisplayOptions
            value={{ ...display, groupBy }}
            inSpace={spaceId !== undefined}
            onChange={(next: TaskDisplay.Display) =>
              setPreference(TaskDisplay.preference, {
                ...next,
                groupBy: next.groupBy === groupBy ? display.groupBy : next.groupBy,
              })
            }
          />
          <NewTaskDialog spaceId={spaceId} trigger={<Button />}>
            <IconPlus data-icon="inline-start" />
            New task
          </NewTaskDialog>
        </>
      }
    >
      <RefreshError query={tasks} />
      <Loading id={shapeId} loading={loading} label="Loading tasks">
        {display.layout === "board" && !loading && !empty ? (
          <TaskBoard groups={groups} properties={properties} stale={stale} onMove={moveTo} />
        ) : (
          <TaskGroups
            groups={groups}
            spaceId={spaceId}
            loading={loading}
            stale={stale}
            filtered={visible.length < roots.length || text !== ""}
            query={query}
            filtersOn={!sameFilters(filters, views.viewFilters)}
            onClearFilters={clearFilters}
            properties={properties}
            idWidth={idWidth}
            selected={selected}
            onSelect={select}
          />
        )}
      </Loading>
      <SelectionBar
        count={selected.length}
        lookups={lookups}
        spaces={spaces.joined}
        onMove={(target) => run("Tasks moved", (id) => assign.mutateAsync({ id, start: "none", spaceId: target }))}
        onUpdate={(patch) => run("Tasks updated", (id) => update.mutateAsync({ id, ...patch }))}
        onAssign={(target) => run("Tasks assigned", (id) => assign.mutateAsync({ id, start: "none", ...target }))}
        onLabel={(name) =>
          run(`Added ${name}`, (id) => update.mutateAsync({ id, labels: [...new Set([...namesOf(id), name])] }))
        }
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

function RefreshError(props: { query: { error: unknown; data: unknown; refetch: () => Promise<unknown> } }) {
  if (!props.query.error || props.query.data === undefined) return null
  return (
    <output className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
      <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
      Couldn’t refresh the tasks. This list may be out of date.
      <Button variant="link" className="h-auto p-0" onClick={() => void props.query.refetch()}>
        Try again
      </Button>
    </output>
  )
}

function SelectionBar(props: {
  count: number
  lookups: TaskLookups
  spaces: ReadonlyArray<{ id: string; name: string }>
  onUpdate: (patch: { status?: TaskInfo["status"]; priority?: TaskInfo["priority"] }) => void
  onAssign: (target: Assignee.Assignment) => void
  onLabel: (name: string) => void
  onMove: (spaceId: string) => void
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
      <span className="flex h-7 items-center rounded-md border border-dashed px-2 text-xs tabular-nums">
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
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Status</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-48">
          <DropdownMenuGroup>
            {Object.entries(statuses).map(([value, status]) => (
              <DropdownMenuItem key={value} onClick={() => isStatus(value) && props.onUpdate({ status: value })}>
                <StatusGlyph status={value} />
                {status.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Priority</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-48">
          <DropdownMenuGroup>
            {[null, ...priorityValues].map((value) => (
              <DropdownMenuItem key={value ?? "none"} onClick={() => props.onUpdate({ priority: value })}>
                <PriorityIcon priority={value} />
                {priorityLabelOf(value)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Agent</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="max-h-80 w-60">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => props.onAssign({ agentId: null })}>
              <IconAgent className="text-muted-foreground/50" />
              No agent
            </DropdownMenuItem>
            {props.lookups.agents.map((agent) => (
              <DropdownMenuItem key={agent.id} onClick={() => props.onAssign({ agentId: agent.id })}>
                <IconAgent />
                {agent.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Assignee</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="max-h-80 w-60">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => props.onAssign({ ownerId: null })}>
              <UnassignedIcon />
              No assignee
            </DropdownMenuItem>
            {props.lookups.members.map((member) => (
              <DropdownMenuItem key={member.id} onClick={() => props.onAssign({ ownerId: member.id })}>
                <PersonAvatar name={member.name} image={member.image} />
                {member.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Add label</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="max-h-80 w-52">
          <DropdownMenuGroup>
            {props.lookups.labels.map((label) => (
              <DropdownMenuItem key={label.id} onClick={() => props.onLabel(label.name)}>
                <ColorDot color={labelColor(label.color, label.name)} />
                {label.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Space</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="max-h-80 w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to a space</DropdownMenuLabel>
            {props.spaces.map((space) => (
              <DropdownMenuItem key={space.id} onClick={() => props.onMove(space.id)}>
                <IconCube />
                {space.name}
              </DropdownMenuItem>
            ))}
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
