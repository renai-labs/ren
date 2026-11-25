import type { Tasks } from "@ren/client/react"
import { memo } from "react"
import { IconAlertTriangle, IconHandStop, IconLink, IconSubtask } from "@tabler/icons-react"
import { IconAgent } from "../../icons/heroicons.js"
import { Badge } from "@ren/ui/badge"
import { Checkbox } from "@ren/ui/checkbox"
import { Button } from "@ren/ui/button"
import { PersonAvatar } from "../../components/person-avatar.js"
import { PriorityMenu, StatusMenu } from "../../components/task-pickers.js"
import { errorMessage } from "../../lib/errors.js"
import { LabelBadge, PriorityIcon, SpaceBadge, StatusIcon, UnassignedIcon } from "../../components/task-meta.js"
import { type Member } from "../../lib/use-members.js"
import { formatShortDate } from "@ren/ui/time"
import { cn } from "cn"
import { useNow } from "../../lib/use-now.js"
import type { TaskInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { TaskAgentPicker, TaskPersonPicker } from "../../components/assignee-picker.js"
import type { Assignee } from "../../components/assignee.js"
import { TaskLink } from "./task-scope.js"
import { TaskActions } from "./task-actions.js"
import { RowContextMenu, RowMenu } from "../../components/row-menu.js"
import { RouterContext } from "../../lib/router-context.js"

type Task = TaskInfo

const dateColumn = "flex w-16 shrink-0 items-center justify-end gap-1 text-xs tabular-nums @max-2xl/tasks:hidden"

function DueDate(props: { status: Task["status"]; dueAt: string | null }) {
  const now = useNow()
  if (!props.dueAt) return <span aria-hidden className={dateColumn} />
  const overdue = TaskActions.overdue(props, now)
  return (
    <span className={cn(dateColumn, overdue ? "text-destructive" : "text-muted-foreground")}>
      {overdue ? <IconAlertTriangle className="size-3.5" /> : null}
      <span className="sr-only">{overdue ? "Overdue, due" : "Due"}</span>
      {formatShortDate(props.dueAt)}
    </span>
  )
}

function ProgressRing(props: { done: number; total: number }) {
  const length = 2 * Math.PI * 5
  return (
    <svg aria-hidden viewBox="0 0 14 14" className="size-3.5 -rotate-90">
      <circle cx="7" cy="7" r="5" fill="none" strokeWidth="2" className="stroke-muted-foreground/30" />
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(props.done / props.total) * length} ${length}`}
        className={props.done === props.total ? "stroke-chart-6" : "stroke-muted-foreground"}
      />
    </svg>
  )
}

export function SubtaskProgress(props: { done: number; total: number; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-6 gap-1.5 rounded-full bg-muted tabular-nums @max-md/tasks:hidden", props.className)}
    >
      <ProgressRing done={props.done} total={props.total} />
      {props.done}/{props.total}
      <span className="sr-only">sub-tasks done</span>
    </Badge>
  )
}

function TaskMeta(props: { task: Task; spaceName: string; show: (property: string) => boolean }) {
  const task = props.task
  const show = props.show
  return (
    <span className="ml-auto flex items-center justify-end gap-1 [&_[data-slot=badge]]:shrink-0 [&_[data-slot=badge]]:bg-transparent [&_[data-slot=badge]]:text-muted-foreground">
      {task.subtasks && task.subtasks.total > 0 ? (
        <SubtaskProgress done={task.subtasks.done} total={task.subtasks.total} />
      ) : null}
      {task.humanReview ? (
        <Badge variant="outline" className="h-6 rounded-full bg-muted">
          <IconHandStop className="text-chart-3" />
          <span className="@max-3xl/tasks:sr-only">Needs review</span>
        </Badge>
      ) : null}
      {show("labels") && task.labels.length > 0 ? (
        <span className="flex h-6 min-w-0 flex-wrap justify-end gap-1 overflow-hidden @max-3xl/tasks:hidden">
          <span aria-hidden className="-mr-1 h-6 w-0" />
          {task.labels.slice(0, 2).map((label) => (
            <LabelBadge key={label.id} name={label.name} color={label.color} className="max-w-32" />
          ))}
          {task.labels.length > 2 ? (
            <Badge
              variant="outline"
              title={task.labels
                .slice(2)
                .map((label) => label.name)
                .join(", ")}
              className="h-6 rounded-full bg-muted tabular-nums"
            >
              +{task.labels.length - 2}
            </Badge>
          ) : null}
        </span>
      ) : null}
      {show("space") ? (
        <span className="contents @max-3xl/tasks:hidden">
          <SpaceBadge name={props.spaceName} />
        </span>
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

function TaskDates(props: { task: Task; show: (property: string) => boolean }) {
  const task = props.task
  return (
    <>
      {props.show("due") ? <DueDate status={task.status} dueAt={task.dueAt} /> : null}
      {props.show("created") ? (
        <span className={cn(dateColumn, "text-muted-foreground")}>{formatShortDate(task.createdAt)}</span>
      ) : null}
      {props.show("updated") ? (
        <span className={cn(dateColumn, "text-muted-foreground")}>{formatShortDate(task.updatedAt)}</span>
      ) : null}
    </>
  )
}

const rowControl = "relative z-10 size-7 data-popup-open:bg-muted"

const branchPaths: Record<Tasks.Branch, string> = {
  middle: "M14 0V44M14 13Q14 22 23 22",
  last: "M14 0V13Q14 22 23 22",
}

function TreeBranch(props: { branch: Tasks.Branch }) {
  return (
    <span aria-hidden className="relative w-6 shrink-0 self-stretch">
      <svg viewBox="0 0 24 44" preserveAspectRatio="none" className="absolute inset-0 size-full opacity-30">
        <path
          d={branchPaths[props.branch]}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-muted-foreground"
        />
      </svg>
    </span>
  )
}

function RowAssignees(props: {
  task: Task
  agentName: string | null
  owner: Member | undefined
  onAssign: (target: Assignee.Assignment) => void
}) {
  const task = props.task
  return (
    <span className="flex shrink-0 items-center gap-1">
      <TaskAgentPicker
        value={task.agentId}
        spaceId={task.spaceId}
        onChange={(agentId) => props.onAssign({ agentId })}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            className={rowControl}
            aria-label={`Agent for ${task.title}: ${props.agentName ?? "No agent"}`}
          />
        }
      >
        <IconAgent className={cn("size-4", !task.agentId && "text-muted-foreground/50")} />
      </TaskAgentPicker>
      <TaskPersonPicker
        value={task.ownerId}
        onChange={(ownerId) => props.onAssign({ ownerId })}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            className={rowControl}
            aria-label={`Assignee for ${task.title}: ${props.owner?.name ?? "No assignee"}`}
          />
        }
      >
        {props.owner ? <PersonAvatar name={props.owner.name} image={props.owner.image} /> : <UnassignedIcon />}
      </TaskPersonPicker>
    </span>
  )
}

// oxlint-disable-next-line ren/no-comments -- Memoized: a list renders hundreds of rows with menus each, and a search keystroke, a selection or a refetch should only re-render the rows that changed.
export const TaskRow = memo(function TaskRow(props: {
  task: Task
  parent?: { readonly identifier: string; readonly title: string } | null
  branch?: Tasks.Branch | undefined
  show: ReadonlyArray<string>
  selected: boolean
  idWidth: number
  agentName: string | null
  spaceName: string
  owner: Member | undefined
  onSelect?: ((selection: { taskId: string; checked: boolean }) => void) | undefined
}) {
  const task = props.task
  const show = (property: string) => props.show.includes(property)
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.task.update.mutationOptions())
  const actions = TaskActions.useItems(task)
  const assign = useMutation(api.task.assign.mutationOptions())
  const reassign = (target: Assignee.Assignment) =>
    assign.mutate(
      { id: task.id, start: "none", ...target },
      { onError: (error) => toast.error("Couldn’t reassign the task", { description: errorMessage(error) }) },
    )
  const change = (patch: { status?: Task["status"]; priority?: Task["priority"] }) =>
    update.mutate(
      { id: task.id, ...patch },
      { onError: (error) => toast.error("Couldn’t save the task", { description: errorMessage(error) }) },
    )
  return (
    <RowContextMenu
      items={actions}
      render={
        <div
          data-selected={props.selected || undefined}
          className="group/row relative flex h-11 items-center gap-2 rounded-lg px-2 text-sm [contain-intrinsic-size:auto_2.75rem] [content-visibility:auto] hover:bg-muted data-selected:bg-muted"
        />
      }
    >
      {props.onSelect ? (
        <Checkbox
          checked={props.selected}
          onCheckedChange={(checked) => props.onSelect?.({ taskId: task.id, checked })}
          aria-label={`Select ${task.title}`}
          className="relative z-10 mx-1 size-3.5 border-muted-foreground/70 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 @max-sm/tasks:hidden dark:bg-card data-checked:opacity-100 [&_[data-slot=checkbox-indicator]>svg]:size-3"
        />
      ) : null}
      {props.branch ? <TreeBranch branch={props.branch} /> : null}
      {show("priority") ? (
        <PriorityMenu
          priority={task.priority}
          onChange={(priority) => change({ priority })}
          trigger={
            <Button variant="ghost" size="icon-sm" className={rowControl} aria-label={`Priority for ${task.title}`} />
          }
        >
          <PriorityIcon priority={task.priority} />
        </PriorityMenu>
      ) : null}
      <span
        className="ml-2 min-w-14 shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums @max-lg/tasks:hidden"
        // oxlint-disable-next-line react/forbid-dom-props -- the ID column fits the longest identifier in the list
        style={{ width: `${props.idWidth}ch` }}
      >
        {task.identifier}
      </span>
      {show("status") ? (
        <StatusMenu
          status={task.status}
          onChange={(status) => change({ status })}
          trigger={
            <Button variant="ghost" size="icon-sm" className={rowControl} aria-label={`Status for ${task.title}`} />
          }
        >
          <StatusIcon task={task} />
        </StatusMenu>
      ) : null}
      <TaskLink
        taskId={task.id}
        className="ml-2 min-w-24 truncate font-medium after:absolute after:inset-0 after:rounded-lg @max-sm/tasks:min-w-0"
      >
        {task.title}
      </TaskLink>
      {props.parent ? (
        <span className="flex max-w-60 min-w-0 items-center gap-1 text-xs text-muted-foreground @max-sm/tasks:hidden">
          <IconSubtask className="size-3.5 shrink-0" />
          <span className="sr-only">Sub-task of</span>
          <span className="truncate">
            {props.parent.identifier} {props.parent.title}
          </span>
        </span>
      ) : null}
      <TaskMeta task={task} spaceName={props.spaceName} show={show} />
      {show("assignee") ? (
        <RowAssignees task={task} agentName={props.agentName} owner={props.owner} onAssign={reassign} />
      ) : null}
      <TaskDates task={task} show={show} />
      <RowMenu
        label={`Actions for ${task.title}`}
        items={actions}
        className="relative z-10 flex text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 @max-sm/tasks:hidden pointer-coarse:opacity-100"
      />
    </RowContextMenu>
  )
})
