import type { TaskInfo } from "@ren/client"
import { Badge } from "@ren/ui/badge"
import { Board } from "@ren/ui/board"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"
import { LoadingMessage } from "@ren/ui/loading-message"
import { StateMessage } from "@ren/ui/state-message"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Toast } from "@ren/ui/toast"
import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { DueDateControl, LabelsControl, OwnerControl, PriorityControl, StatusControl } from "./task-controls.js"
import { AttentionTurn } from "./task-attention.js"
import type { TaskListProps } from "./task-list.js"
import { TaskView } from "./task-view.js"
import { Tasks } from "./tasks.js"

type Props = TaskListProps & { onArchive: (task: TaskInfo) => void }

export function TaskBoard(props: Props) {
  const context = RouterContext.useRouterContext()
  const spaceId = TaskView.preferredSpace(props.view.filters)
  const space = useQuery({ ...context.api.space.get.queryOptions({ idOrSlug: spaceId }), enabled: spaceId !== "" })
  if (!spaceId)
    return (
      <StateMessage
        state="empty"
        title="Choose a space"
        description="The board follows one space’s factory order. Choose a space to see its tasks."
      />
    )
  if (space.isError)
    return <StateMessage state="failed" title="Couldn’t load factory order." onRetry={() => void space.refetch()} />
  if (!space.data) return <LoadingMessage placement="section" />
  return (
    <Columns
      {...props}
      groups={TaskView.boardGroups(
        space.data,
        props.catalog.agents,
        TaskView.visible(props.groups.flatMap((group) => group.tasks), props.view),
      )}
    />
  )
}

function Columns(props: Props) {
  return (
    <Board.Root label="Task board">
      {props.groups.map((group) => (
        <Board.Column
          key={group.id}
          label={group.name}
          header={
            <>
              <Icon glyph="Bot" tone="secondary" />
              <div className="min-w-0">
                <Text purpose="label" truncation="single-line" element="h2" title={group.name}>
                  {group.name}
                </Text>
              </div>
              <Text purpose="caption" numerals="tabular" element="span" aria-label={`${group.tasks.length} tasks`}>
                {group.tasks.length}
              </Text>
              <span className="ml-auto flex">
                <IconButton
                  size="compact"
                  label={`Add task to ${group.name}`}
                  onClick={() => props.onCreate({ agentId: group.agentId })}
                >
                  <Icon glyph="Plus" />
                </IconButton>
              </span>
            </>
          }
        >
          <ul className="flex flex-col gap-2">
            {group.tasks.map((task) => (
              <li key={task.id}>
                <Card {...props} task={task} />
              </li>
            ))}
          </ul>
        </Board.Column>
      ))}
    </Board.Root>
  )
}

function Card(props: Props & { task: TaskInfo }) {
  const task = props.task
  const shown = new Set(props.view.boardProperties)
  const control = {
    task,
    presentation: "icon" as const,
    disabled: !task.canUpdate,
    onChange: (patch: Tasks.Patch) => props.actions.update(task, patch),
  }
  return (
    <Board.Card
      selected={props.selected.has(task.id)}
      onOpen={() => props.onOpen(task)}
      meta={
        <Text purpose="code" tone="secondary" truncation="single-line" element="span" title={task.identifier}>
          {task.identifier}
        </Text>
      }
      corner={
        shown.has("owner") ? (
          <OwnerControl
            {...control}
            owner={task.ownerId ? props.catalog.person(task.ownerId) : undefined}
            onAssign={(assignment) => props.actions.assign(task, assignment)}
          />
        ) : undefined
      }
      leading={shown.has("status") ? <StatusControl {...control} /> : undefined}
      title={
        <Button appearance="text" wrapping="normal" onClick={() => props.onOpen(task)} title={task.title}>
          {task.title}
        </Button>
      }
      turn={
        <AttentionTurn
          task={task}
          owner={TaskView.attentionOwner(task, props.userId, props.catalog.person)}
          turn={TaskView.turn(task, {
            agent: props.catalog.agentName,
            owner: (id) => props.catalog.person(id)?.name,
            userId: props.userId,
          })}
        />
      }
      chips={
        <>
          {task.humanReview ? (
            <Badge tone="warning" size="small">
              Needs review
            </Badge>
          ) : null}
          {shown.has("priority") ? <PriorityControl {...control} /> : null}
          {shown.has("labels") ? <LabelsControl {...control} /> : null}
          {shown.has("links")
            ? task.links.map((link) => <TaskLinkBadge key={link.id} link={link} size="small" />)
            : null}
          {shown.has("due") ? <DueDateControl {...control} /> : null}
        </>
      }
      footer={
        <>
          {shown.has("created") ? (
            <Text purpose="caption" element="span" wrapping="none">
              Created <Time value={task.createdAt} format="short-date" label="Created" />
            </Text>
          ) : null}
          {shown.has("updated") ? (
            <Text purpose="caption" element="span" wrapping="none">
              Updated <Time value={task.updatedAt} format="short-date" label="Updated" />
            </Text>
          ) : null}
        </>
      }
      actions={<CardActions {...props} />}
    />
  )
}

function CardActions(props: Props & { task: TaskInfo }) {
  const context = RouterContext.useRouterContext()
  const agents = Tasks.useSpaceAgents(props.task.spaceId, { enabled: true })
  const assign = Tasks.useTaskMutation(context.api.task.assign.mutationOptions())
  const start = Tasks.useTaskMutation(context.api.task.start.mutationOptions())
  const fail = (cause: unknown) =>
    Toast.manager.add({ type: "error", title: "Couldn’t update task", description: Tasks.describe(cause) })
  const move = (agentId: string | null) =>
    assign.mutate({ id: props.task.id, agentId, start: "none" }, { onError: fail })
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton size="small" label={`Actions for ${props.task.title}`}>
              <Icon glyph="MoreHorizontal" />
            </IconButton>
          }
        />
        <Menu.Popup alignment="end">
          <Menu.Item onSelect={() => props.onOpen(props.task)}>Open task</Menu.Item>
          {props.task.canUpdate ? (
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger>Move to agent</Menu.SubmenuTrigger>
              <Menu.SubmenuPopup>
                {agents.isPending ? <Menu.Message>Loading agents…</Menu.Message> : null}
                {agents.isError ? (
                  <Menu.Item onSelect={() => void agents.refetch()}>Retry loading agents</Menu.Item>
                ) : null}
                {agents.data?.map((agent) => (
                  <Menu.Item
                    key={agent.id}
                    disabled={assign.isPending}
                    onSelect={() => move(agent.id)}
                    icon={props.task.agentId === agent.id ? <Icon glyph="Check" /> : undefined}
                  >
                    {agent.name}
                  </Menu.Item>
                ))}
                <Menu.Separator />
                <Menu.Item
                  disabled={assign.isPending}
                  onSelect={() => move(null)}
                  icon={props.task.agentId === null ? <Icon glyph="Check" /> : undefined}
                >
                  No agent
                </Menu.Item>
              </Menu.SubmenuPopup>
            </Menu.SubmenuRoot>
          ) : null}
          <Menu.Separator />
          <Menu.Item tone="danger" disabled={!props.task.canUpdate} onSelect={() => props.onArchive(props.task)}>
            Archive task
          </Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      {props.task.agentId && TaskView.isActionable(props.task) ? (
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton
                size="small"
                label={`Start agent for ${props.task.title}`}
                disabled={!props.task.canUpdate || start.isPending}
              >
                <Icon glyph="Play" />
              </IconButton>
            }
          />
          <Menu.Popup alignment="end">
            <Menu.Item
              onSelect={() => start.mutate({ id: props.task.id, mode: "continue" }, { onError: fail })}
            >
              Continue session
            </Menu.Item>
            <Menu.Item onSelect={() => start.mutate({ id: props.task.id, mode: "new" }, { onError: fail })}>
              Start new session
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      ) : null}
    </>
  )
}
