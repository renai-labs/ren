import type { TaskInfo } from "@ren/client"
import { Board } from "@ren/ui/board"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Spinner } from "@ren/ui/spinner"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { DueDateControl, LabelsControl, OwnerControl, PriorityControl, StatusControl } from "./task-controls.js"
import { AttentionTurn } from "./task-attention.js"
import { TaskBadges } from "./task-list.js"
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
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Choose a space</EmptyTitle>
          <EmptyDescription>
            The board follows one space’s factory order. Choose a space to see its tasks.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (space.isError)
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon glyph="AlertCircle" tone="danger" />
          </EmptyMedia>
          <EmptyTitle>Couldn’t load factory order.</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => void space.refetch()}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  if (!space.data)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  return (
    <Columns
      {...props}
      groups={TaskView.boardGroups(
        space.data,
        props.catalog.agents,
        TaskView.visible(
          props.groups.flatMap((group) => group.tasks),
          props.view,
        ),
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`Add task to ${group.name}`}
                  onClick={() => props.onCreate({ agentId: group.agentId })}
                >
                  <Icon glyph="Plus" />
                </Button>
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
        <Button
          variant="link"
          className="h-auto min-w-0 justify-start px-0 text-left wrap-break-word whitespace-normal text-foreground hover:no-underline"
          onClick={() => props.onOpen(task)}
          title={task.title}
        >
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
          <TaskBadges task={task} />
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
  const assign = useMutation(context.api.task.assign.mutationOptions())
  const start = useMutation(context.api.task.start.mutationOptions())
  const fail = (cause: unknown) =>
    toast.add({ type: "error", title: "Couldn’t update task", description: Tasks.describe(cause) })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Actions for ${props.task.title}`}
            />
          }
        >
          <Icon glyph="MoreHorizontal" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => props.onOpen(props.task)}>Open task</DropdownMenuItem>
            {props.task.canUpdate ? (
              <MoveToAgent
                task={props.task}
                agents={agents}
                pending={assign.isPending}
                onMove={(agentId) => assign.mutate({ id: props.task.id, agentId, start: "none" }, { onError: fail })}
              />
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={!props.task.canUpdate}
              onClick={() => props.onArchive(props.task)}
            >
              Archive task
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {props.task.agentId && TaskView.isActionable(props.task) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={`Start agent for ${props.task.title}`}
                disabled={!props.task.canUpdate || start.isPending}
              />
            }
          >
            <Icon glyph="Play" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => start.mutate({ id: props.task.id, mode: "continue" }, { onError: fail })}
              >
                Continue session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => start.mutate({ id: props.task.id, mode: "new" }, { onError: fail })}>
                Start new session
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}

function MoveToAgent(props: {
  task: TaskInfo
  agents: ReturnType<typeof Tasks.useSpaceAgents>
  pending: boolean
  onMove: (agentId: string | null) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Move to agent</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        <DropdownMenuGroup>
          {props.agents.isPending ? <DropdownMenuLabel>Loading agents…</DropdownMenuLabel> : null}
          {props.agents.isError ? (
            <DropdownMenuItem onClick={() => void props.agents.refetch()}>Retry loading agents</DropdownMenuItem>
          ) : null}
          {props.agents.data?.map((agent) => (
            <DropdownMenuItem key={agent.id} disabled={props.pending} onClick={() => props.onMove(agent.id)}>
              {props.task.agentId === agent.id ? <Icon glyph="Check" /> : null}
              {agent.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={props.pending} onClick={() => props.onMove(null)}>
            {props.task.agentId === null ? <Icon glyph="Check" /> : null}
            No agent
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
