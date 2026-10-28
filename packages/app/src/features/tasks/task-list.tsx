import type { TaskInfo } from "@ren/client"
import type { Task } from "@ren/schema/task"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Icon } from "@ren/ui/icon"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { TaskRow } from "@ren/ui/task-row"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { TaskSubtaskProgress } from "@ren/ui/task-subtask-progress"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { useState } from "react"
import type { ReactNode } from "react"
import { AttentionTurn } from "./task-attention.js"
import { DueDateControl, LabelsControl, OwnerControl, PriorityControl, StatusControl } from "./task-controls.js"
import { TaskSearch } from "./task-search.js"
import { TaskView } from "./task-view.js"
import type { Tasks } from "./tasks.js"

export type TaskListProps = {
  view: TaskView.View
  groups: ReadonlyArray<TaskView.Group>
  catalog: ReturnType<typeof Tasks.useCatalog>
  userId: string
  selected: ReadonlySet<string>
  onToggleSelected: (id: string) => void
  onCreate: (preset: { readonly agentId?: string | null; readonly status?: Task.Status }) => void
  onOpen: (task: TaskInfo) => void
  actions: ReturnType<typeof Tasks.useTaskActions>
}

export function TaskList(props: TaskListProps) {
  const shown = new Set(props.view.properties)
  return (
    <div className="flex min-w-0 flex-col">
      {props.groups.map((group) => (
        <TaskGroup
          key={group.id}
          label={group.name}
          leading={group.status ? <TaskStatusCircle status={group.status} /> : <Icon glyph="Bot" tone="secondary" />}
          meta={
            <Text purpose="caption" numerals="tabular" element="span" aria-label={`${group.tasks.length} tasks`}>
              {group.tasks.length}
            </Text>
          }
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Add task to ${group.name}`}
              onClick={() => props.onCreate(group.status ? { status: group.status } : { agentId: group.agentId })}
            >
              <Icon glyph="Plus" />
            </Button>
          }
        >
          {TaskView.tree(group.tasks).map((entry) => (
            <Row key={entry.task.id} {...props} entry={entry} shown={shown} />
          ))}
        </TaskGroup>
      ))}
    </div>
  )
}

export function TaskGroup(props: {
  label: string
  leading?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={<section aria-label={props.label} />}
      className="flex min-w-0 flex-col"
    >
      <header className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-muted pr-2 pl-1">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`${open ? "Collapse" : "Expand"} ${props.label}`}
            />
          }
        >
          <Icon glyph={open ? "ChevronDown" : "ChevronRight"} />
        </CollapsibleTrigger>
        {props.leading}
        <Text purpose="label" element="h2" truncation="single-line" title={props.label}>
          {props.label}
        </Text>
        {props.meta}
        {props.actions === undefined ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">{props.actions}</span>
        )}
      </header>
      <CollapsibleContent
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the rows are divs with role="listitem", which a <ul> cannot hold
        role="list"
        className="flex min-w-0 flex-col"
      >
        {props.children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function Row(
  props: TaskListProps & {
    entry: TaskView.Entry
    shown: ReadonlySet<TaskSearch.Property>
  },
) {
  const task = props.entry.task
  const control = {
    task,
    presentation: "icon" as const,
    disabled: !task.canUpdate,
    onChange: (patch: Tasks.Patch) => props.actions.update(task, patch),
  }
  return (
    <TaskRow
      title={task.title}
      branch={props.entry.branch}
      parent={props.entry.parent}
      selected={props.selected.has(task.id)}
      onOpen={() => props.onOpen(task)}
      selection={
        <Checkbox
          checked={props.selected.has(task.id)}
          onCheckedChange={() => props.onToggleSelected(task.id)}
          aria-label={`Select ${task.title}`}
          className="mx-1 size-3.5 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/task-row:opacity-100 data-checked:opacity-100"
        />
      }
      leading={
        <>
          {props.shown.has("priority") ? <PriorityControl {...control} /> : null}
          <Text
            purpose="code"
            tone="secondary"
            truncation="single-line"
            measure="identifier"
            element="span"
            title={task.identifier}
          >
            {task.identifier}
          </Text>
          {props.shown.has("status") ? <StatusControl {...control} /> : null}
        </>
      }
      badge={<TaskBadges task={task} />}
      aside={
        <>
          {props.shown.has("labels") ? <LabelsControl {...control} /> : null}
          {props.shown.has("links")
            ? task.links.map((link) => <TaskLinkBadge key={link.id} link={link} size="small" />)
            : null}
        </>
      }
      turn={
        <AttentionTurn
          task={task}
          owner={TaskView.attentionOwner(task, props.userId, props.catalog.person)}
          turn={{
            ...TaskView.turn(task, {
              agent: props.catalog.agentName,
              owner: (id) => props.catalog.person(id)?.name,
              userId: props.userId,
            }),
            truncation: "single-line",
          }}
        />
      }
      trailing={
        <>
          {props.shown.has("due") && task.dueAt !== null ? <DueDateControl {...control} /> : null}
          {props.shown.has("owner") ? (
            <OwnerControl
              {...control}
              owner={task.ownerId ? props.catalog.person(task.ownerId) : undefined}
              onAssign={(assignment) => props.actions.assign(task, assignment)}
            />
          ) : null}
          {props.shown.has("created") ? (
            <Text purpose="caption" element="span" wrapping="none" numerals="tabular">
              <Time value={task.createdAt} format="short-date" label="Created" />
            </Text>
          ) : null}
          {props.shown.has("updated") ? (
            <Text purpose="caption" element="span" wrapping="none" numerals="tabular">
              <Time value={task.updatedAt} format="short-date" label="Updated" />
            </Text>
          ) : null}
        </>
      }
    />
  )
}

export function TaskBadges(props: { task: TaskInfo }) {
  const subtasks = props.task.subtasks
  return (
    <>
      {subtasks && subtasks.total > 0 ? <TaskSubtaskProgress done={subtasks.done} total={subtasks.total} /> : null}
      {props.task.humanReview ? (
        <Badge variant="outline" className="rounded-full bg-muted">
          Needs review
        </Badge>
      ) : null}
    </>
  )
}
