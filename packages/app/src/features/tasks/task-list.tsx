import type { TaskInfo } from "@ren/client"
import type { Task } from "@ren/schema/task"
import { Badge } from "@ren/ui/badge"
import { Checkbox } from "@ren/ui/checkbox"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { TaskRow } from "@ren/ui/task-row"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { AttentionTurn } from "./task-attention.js"
import { DueDateControl, LabelsControl, OwnerControl, PriorityControl, StatusControl } from "./task-controls.js"
import { TaskSearch } from "./task-search.js"
import { TaskView } from "./task-view.js"
import type { Tasks } from "./tasks.js"

type TaskListProps = {
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
        <List.Group
          key={group.id}
          title={group.name}
          label={group.name}
          leading={group.status ? <TaskStatusCircle status={group.status} /> : <Icon glyph="Bot" tone="secondary" />}
          meta={
            <Text purpose="caption" numerals="tabular" element="span" aria-label={`${group.tasks.length} tasks`}>
              {group.tasks.length}
            </Text>
          }
          actions={
            <IconButton
              size="compact"
              label={`Add task to ${group.name}`}
              onClick={() => props.onCreate(group.status ? { status: group.status } : { agentId: group.agentId })}
            >
              <Icon glyph="Plus" />
            </IconButton>
          }
        >
          {group.tasks.map((task) => (
            <Row key={task.id} {...props} task={task} shown={shown} />
          ))}
        </List.Group>
      ))}
    </div>
  )
}

function Row(
  props: TaskListProps & {
    task: TaskInfo
    shown: ReadonlySet<TaskSearch.Property>
  },
) {
  const task = props.task
  const control = {
    task,
    presentation: "icon" as const,
    disabled: !task.canUpdate,
    onChange: (patch: Tasks.Patch) => props.actions.update(task, patch),
  }
  return (
    <TaskRow
      title={task.title}
      selected={props.selected.has(task.id)}
      onOpen={() => props.onOpen(task)}
      selection={
        <Checkbox
          checked={props.selected.has(task.id)}
          onCheckedChange={() => props.onToggleSelected(task.id)}
          label={`Select ${task.title}`}
          size="small"
          visibility="on-container-hover"
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
      badge={
        task.humanReview ? (
          <Badge tone="warning" size="small">
            Needs review
          </Badge>
        ) : undefined
      }
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
