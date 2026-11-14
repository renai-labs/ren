import { useState, type ComponentType } from "react"
import { useScrollEdges } from "../../lib/use-scroll-edges.js"
import type { TaskInfo } from "@ren/client"
import { IconCalendarDue, IconGhostFilled, IconHandStop, IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
import { NewTaskDialog } from "../../components/new-task-dialog.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { LabelBadge, PriorityIcon, SpaceBadge, StatusIcon, UnassignedIcon } from "../../components/task-meta.js"
import { formatShortDate } from "@ren/ui/time"
import { useAgents } from "../../lib/use-agents.js"
import { useMembers } from "../../lib/use-members.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { LinkChip } from "./task-links.js"
import { TaskCardActions } from "./task-card-actions.js"
import { TaskLink } from "./task-scope.js"

export type BoardGroup = {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<{ className?: string }>
  readonly spaceId: string | undefined
  readonly tasks: ReadonlyArray<TaskInfo>
}

const dragType = "application/x-ren-task"

function BoardAssignee(props: { task: TaskInfo }) {
  const agent = useAgents().agent(props.task.agentId)
  const owner = useMembers().member(props.task.ownerId)
  if (props.task.agentId) return <IconGhostFilled className="size-4" aria-label={agent?.name ?? "Agent"} />
  if (owner) return <PersonAvatar name={owner.name} image={owner.image} />
  return <UnassignedIcon />
}

function CardFooter(props: { task: TaskInfo; show: (property: string) => boolean }) {
  const task = props.task
  const show = props.show
  const spaces = useSpaces()
  const space = show("space") ? <SpaceBadge name={spaces.spaceName(task.spaceId)} /> : null
  const labels = show("labels") ? task.labels : []
  const priority = show("priority") ? task.priority : null
  const due = show("due") ? task.dueAt : null
  if (!space && labels.length === 0 && !priority && !due) return null
  return (
    <div className={cn("flex min-h-5 flex-wrap items-center gap-1.5", show("status") && "pl-6")}>
      {space}
      {labels.map((label) => (
        <LabelBadge key={label.id} name={label.name} color={label.color} />
      ))}
      <span className="grow" />
      {due ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <IconCalendarDue className="size-3.5" />
          {formatShortDate(due)}
        </span>
      ) : null}
      {priority ? <PriorityIcon priority={priority} /> : null}
    </div>
  )
}

function BoardCard(props: {
  task: TaskInfo
  show: (property: string) => boolean
  dragging: boolean
  onDrag: (taskId: string) => void
}) {
  const task = props.task
  const show = props.show
  const link = task.links.find((each) => each.kind === "github_pr") ?? task.links.at(0)
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(dragType, task.id)
        event.dataTransfer.effectAllowed = "move"
        props.onDrag(task.id)
      }}
      className={cn(
        "group/card relative flex cursor-grab flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-sm transition-[opacity,background-color] duration-150 ease-out hover:bg-muted/50 active:cursor-grabbing",
        props.dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {show("status") ? (
          <span className="flex h-5 shrink-0 items-center">
            <StatusIcon task={task} />
          </span>
        ) : null}
        <TaskLink
          taskId={task.id}
          draggable={false}
          className="line-clamp-2 min-w-0 grow font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
        >
          {task.title}
        </TaskLink>
        <span className="flex h-5 shrink-0 items-center gap-1.5">
          {task.humanReview ? <IconHandStop aria-label="Needs your review" className="size-4 text-chart-3" /> : null}
          {link ? <LinkChip link={link} /> : null}
          {show("assignee") ? <BoardAssignee task={task} /> : null}
        </span>
      </div>
      <CardFooter task={task} show={show} />
      <TaskCardActions task={task} />
    </div>
  )
}

export function TaskBoard(props: {
  groups: ReadonlyArray<BoardGroup>
  properties: ReadonlyArray<string>
  stale: boolean
  onMove: (input: { taskId: string; groupId: string }) => Promise<unknown>
}) {
  const [dragging, setDragging] = useState<string>()
  const [over, setOver] = useState<string>()
  const [pending, setPending] = useState<Readonly<Record<string, string>>>({})
  const everyTask = new Map(props.groups.flatMap((group) => group.tasks.map((task) => [task.id, task] as const)))
  const groups = props.groups.map((group) => ({
    ...group,
    tasks: [
      ...Object.entries(pending).flatMap((entry) => {
        const task = everyTask.get(entry[0])
        return entry[1] === group.id && task && !group.tasks.includes(task) ? [task] : []
      }),
      ...group.tasks.filter((task) => (pending[task.id] ?? group.id) === group.id),
    ],
  }))
  const move = (taskId: string, groupId: string) => {
    setPending((current) => ({ ...current, [taskId]: groupId }))
    void props
      .onMove({ taskId, groupId })
      .finally(() =>
        setPending((current) => Object.fromEntries(Object.entries(current).filter((entry) => entry[0] !== taskId))),
      )
  }
  const show = (property: string) => props.properties.includes(property)
  const [boardRef, edges] = useScrollEdges()
  return (
    <div
      className={cn(
        "relative -mx-2 h-[calc(100svh-var(--spacing)*28)] min-h-80 transition-opacity",
        props.stale && "opacity-60",
      )}
    >
      <div
        ref={boardRef}
        className={cn(
          "absolute inset-0 scrollbar-none overflow-auto overscroll-contain",
          edges.start && edges.end && "mask-x-from-94%",
          edges.start && !edges.end && "mask-l-from-94%",
          !edges.start && edges.end && "mask-r-from-94%",
        )}
        onDragEnd={() => {
          setDragging(undefined)
          setOver(undefined)
        }}
      >
        <div className="flex min-h-full w-max gap-3 px-2 pb-16">
          {groups.map((group) => (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a drop target for dragged cards; the selection bar moves tasks by keyboard
            <section
              key={group.id}
              aria-label={group.label}
              onDragEnter={(event) => {
                if (event.dataTransfer.types.includes(dragType)) setOver(group.id)
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(dragType)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
              }}
              onDrop={(event) => {
                event.preventDefault()
                const taskId = event.dataTransfer.getData(dragType)
                setOver(undefined)
                setDragging(undefined)
                if (taskId && !group.tasks.some((task) => task.id === taskId)) move(taskId, group.id)
              }}
              className={cn(
                "flex w-80 shrink-0 flex-col gap-2 rounded-xl p-1 transition-colors duration-150 ease-out",
                over === group.id && "bg-muted/40",
              )}
            >
              <header className="flex h-8 items-center gap-2 px-1 text-sm">
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
              </header>
              <div className="flex min-h-16 flex-1 flex-col gap-2">
                {over === group.id && dragging && !group.tasks.some((task) => task.id === dragging) ? (
                  <div aria-hidden className="h-20 shrink-0 rounded-xl border border-dashed border-ring/60 bg-ring/5" />
                ) : null}
                {group.tasks.map((task) => (
                  <BoardCard
                    key={task.id}
                    task={task}
                    show={show}
                    dragging={dragging === task.id}
                    onDrag={setDragging}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-linear-to-t from-background to-transparent"
      />
    </div>
  )
}
