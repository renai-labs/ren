import type { TaskInfo } from "@ren/client"
import { EmptyState } from "@/components/ren/empty-state"
import { Link } from "@tanstack/react-router"
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
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ExpandableSearch } from "@/components/ren/expandable-search"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { Page, SkeletonRows } from "@/components/ren/page"
import { NewTaskDialog } from "@/components/ren/new-task-dialog"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { FilterChips, FilterMenu } from "@/components/ren/filter-menu"
import { DisplayOptions, countedTaskProperties, taskProperties } from "@/components/ren/task-filters"
import { LabelBadge, PriorityIcon, StatusGlyph, StatusIcon, UnassignedIcon, statuses } from "@/components/ren/task-meta"
import type { Member } from "@/hooks/use-members"
import { formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTasksPage } from "@/routes/tasks/use-tasks-page"
import type { TaskLookups } from "@/components/ren/task-filters"

type Task = TaskInfo

function TaskRow(props: {
  task: Task
  show: string[]
  selected: boolean
  idWidth: number
  agentName: string | null
  owner: Member | undefined
  onSelect: (selected: boolean) => void
}) {
  const task = props.task
  const owner = props.owner?.name
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
        className="relative z-10 mx-1 size-3.5 border-muted-foreground/70 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 dark:bg-card data-checked:opacity-100 [&_svg]:size-3!"
      />
      {show("priority") ? <PriorityIcon priority={task.priority} /> : null}
      <span
        className="ml-2 min-w-20 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground"
        style={{ width: `${props.idWidth}ch` }}
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
      {show("assignee") ? (
        <span className="flex size-6 shrink-0 items-center justify-center">
          {task.agentId ? (
            <IconGhost className="size-4 text-muted-foreground" aria-label={props.agentName ?? "Agent"} />
          ) : owner ? (
            <PersonAvatar name={owner} image={props.owner?.image} />
          ) : (
            <UnassignedIcon />
          )}
        </span>
      ) : null}
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

export function TasksPage() {
  const page = useTasksPage()
  const display = page.display
  const visible = page.visible
  const roots = page.roots
  const selected = page.selected
  const groupings = groupingsFor(page.lookups)
  const grouping =
    display.groupBy === "status" ? groupings.status : display.groupBy === "agent" ? groupings.agent : groupings.space
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
      leading={
        <FilterChips properties={taskProperties(page.lookups)} value={page.filters} onChange={page.setFilters} />
      }
      actions={
        <>
          <ExpandableSearch label="Search tasks" value={page.query} onChange={page.setQuery} />
          <FilterMenu
            label="Filter tasks"
            properties={countedTaskProperties(page.lookups, roots)}
            value={page.filters}
            onChange={page.setFilters}
            noun="task"
          />
          <DisplayOptions value={display} />
          <NewTaskDialog trigger={<Button />}>
            <IconPlus data-icon="inline-start" />
            New task
          </NewTaskDialog>
        </>
      }
    >
      {page.loading ? (
        <SkeletonRows />
      ) : groups.length === 0 && visible.length < roots.length ? (
        <EmptyState
          action={
            <Button variant="outline" onClick={page.clearFilters}>
              Clear filters
            </Button>
          }
        >
          No tasks match these filters
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState action={<NewTaskDialog trigger={<Button variant="outline" />}>New task</NewTaskDialog>}>
          No tasks yet
        </EmptyState>
      ) : (
        <div className={cn("flex flex-col transition-opacity", page.stale && "opacity-60")}>
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
                    show={display.properties}
                    idWidth={page.idWidth}
                    agentName={page.agentName(task.agentId)}
                    owner={page.member(task.ownerId)}
                    selected={selected.includes(task.id)}
                    onSelect={(checked) =>
                      page.setSelected((current) =>
                        checked ? [...current, task.id] : current.filter((id) => id !== task.id),
                      )
                    }
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
      <SelectionBar
        count={selected.length}
        agents={page.lookups.agents}
        onStatus={page.setStatus}
        onMove={page.move}
        onArchive={() => page.setArchiving(true)}
        onClear={() => page.setSelected([])}
      />
      <ConfirmDialog
        open={page.archiving}
        onOpenChange={page.setArchiving}
        confirmation={
          selected.length === 1
            ? {
                title: "Archive task?",
                description: `“${page.tasks.find((task) => task.id === selected.at(0))?.title ?? "This task"}” will be removed from Tasks.`,
                action: "Archive",
              }
            : {
                title: `Archive ${selected.length} tasks?`,
                description: "These tasks will be removed from Tasks.",
                action: "Archive",
              }
        }
        onConfirm={page.archiveSelected}
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
        <button
          type="button"
          aria-label="Clear selection"
          onClick={props.onClear}
          className="-mr-1 ml-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <IconX className="size-3.5" />
        </button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Change status</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-48">
          {Object.entries(statuses).map(([value, status]) => (
            <DropdownMenuItem key={value} onClick={() => props.onStatus(value)}>
              <StatusGlyph status={value} />
              {status.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>Move</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          {props.agents.map((agent) => (
            <DropdownMenuItem key={agent.id} onClick={() => props.onMove(agent.id)}>
              <IconGhost />
              {agent.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => props.onMove(null)}>
            <UnassignedIcon />
            No agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={props.onArchive}>
        <IconArchive />
        Archive
      </Button>
    </div>
  )
}
