import { SkeletonRows } from "../../components/page.js"
import { useState, type ReactNode } from "react"
import type { TaskInfo, TaskUpdateInput } from "@ren/client"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import {
  IconArrowUpLeft,
  IconCalendarDue,
  IconCheck,
  IconChecklist,
  IconChevronRight,
  IconCube,
  IconDots,
  IconGhostFilled,
  IconHandStop,
  IconHistory,
  IconMessage,
  IconPlayerPlay,
  IconPlus,
  IconTag,
  IconUserCircle,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import { Calendar } from "@ren/ui/calendar"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Separator } from "@ren/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { Textarea } from "@ren/ui/textarea"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import {
  LabelBadge,
  PriorityIcon,
  StatusIcon,
  labelColor,
  priorityLabelOf,
  statusOf,
} from "../../components/task-meta.js"
import { formatDate } from "@ren/ui/time"
import { errorMessage } from "../../lib/errors.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { RouterContext } from "../../lib/router-context.js"
import { Seed } from "../../lib/seed.js"
import { allTasksKey, refreshEvery } from "../../lib/tasks.js"
import { useAgents } from "../../lib/use-agents.js"
import { useLabels } from "../../lib/use-labels.js"
import { useMembers, type Member } from "../../lib/use-members.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { ColorDot } from "@ren/ui/color-dot"
import { TaskDescription } from "./task-description.js"
import { TaskActivity } from "./task-activity.js"
import { TaskLinks } from "./task-links.js"
import { PriorityMenu, StatusMenu } from "../../components/task-pickers.js"
import { NewTaskDialog } from "../../components/new-task-dialog.js"
import { cn } from "cn"

const propertyButton =
  "-ml-2.5 h-8 w-fit justify-start gap-2 rounded-full px-2.5 font-normal data-popup-open:bg-muted [&_svg:not([class*='text-'])]:text-muted-foreground"

const pickerCommand = "rounded-none! **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:text-xs"
const pickerItem = "gap-2"

function PropertySection(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-1 text-sm text-muted-foreground">{props.title}</h2>
      {props.children}
    </section>
  )
}

const route = getRouteApi("/_authed/_shell/tasks/$taskId/")

type Patch = Omit<TaskUpdateInput, "id">

type Assignment = { agentId?: string | null; ownerId?: string | null; spaceId?: string }

const failed = (title: string) => (error: Error) => toast.error(title, { description: errorMessage(error) })

function pickShown(patch: Patch): Partial<TaskInfo> {
  return {
    ...(patch.title && { title: patch.title }),
    ...(patch.status && { status: patch.status }),
    ...(patch.priority !== undefined && { priority: patch.priority }),
    ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
  }
}

export function TaskPage(props: { session: ((dock: ReactNode) => ReactNode) | null }) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const params = route.useParams()
  const search = route.useSearch()
  const navigate = useNavigate()
  const navigateHere = route.useNavigate()
  const openSession = (session: string | undefined) =>
    void navigateHere({ search: (previous) => ({ ...previous, session }) })
  const stored = useSuspenseQuery({
    ...api.task.get.queryOptions({ idOrSlug: params.taskId }),
    refetchInterval: refreshEvery,
    ...Seed.fromList<TaskInfo>(queryClient, [api.task.list.queryKey(), allTasksKey()], params.taskId),
  }).data
  const update = useMutation(api.task.update.mutationOptions())
  const assign = useMutation(api.task.assign.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const [archiving, setArchiving] = useState(false)
  const pending = update.isPending ? update.variables : undefined
  const task: TaskInfo = pending ? { ...stored, ...pickShown(pending) } : stored
  const change = (patch: Patch) =>
    update.mutate({ id: task.id, ...patch }, { onError: failed("Couldn’t save the task") })
  const reassign = (target: Assignment) =>
    assign.mutate({ id: task.id, start: "none", ...target }, { onError: failed("Couldn’t reassign the task") })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskHeader
        task={task}
        onChange={change}
        onAssign={reassign}
        onOpenSession={openSession}
        onArchive={() => setArchiving(true)}
      />
      <div className="flex min-h-0 flex-1 gap-8 overflow-y-auto overscroll-contain pr-8 pl-2">
        <TaskArticle task={task} onChange={change} onOpenSession={openSession} />
        <aside aria-label="Task properties" className="flex w-70 shrink-0 flex-col gap-6 pt-12">
          <PropertySection title="Properties">
            <StatusProperty task={task} onChange={change} />
            <PriorityProperty task={task} onChange={change} />
            <AssigneeProperty task={task} onAssign={reassign} />
            <DueDateProperty task={task} onChange={change} />
          </PropertySection>
          {task.links.length > 0 ? (
            <PropertySection title="Links">
              <TaskLinks links={task.links} />
            </PropertySection>
          ) : null}
          <PropertySection title="Labels">
            <LabelsProperty task={task} onChange={change} />
          </PropertySection>
          <PropertySection title="Space">
            <SpaceProperty task={task} onAssign={reassign} />
          </PropertySection>
          {task.createdBy.sessionId ? (
            <PropertySection title="Created in session">
              <CreatedInProperty sessionId={task.createdBy.sessionId} onOpenSession={openSession} />
            </PropertySection>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        confirmation={{
          title: "Archive this task?",
          description: "It leaves the task list. Its chats stay.",
          action: "Archive",
        }}
        onConfirm={() =>
          archive.mutateAsync(
            { id: task.id },
            {
              onSuccess: () => {
                toast.success(`${task.identifier} archived`)
                void navigate({ to: "/tasks" })
              },
              onError: failed("Couldn’t archive the task"),
            },
          )
        }
      />
      <Sheet open={search.session !== undefined} onOpenChange={(open) => (open ? undefined : openSession(undefined))}>
        <SheetContent className="data-[side=right]:sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Task session</SheetTitle>
            <SheetDescription>Chat with the agent working on this task.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            {props.session?.(task.humanReview ? <ReviewCard task={task} /> : null)}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TaskHeader(props: {
  task: TaskInfo
  onChange: (patch: Patch) => void
  onAssign: (target: Assignment) => void
  onOpenSession: (session: string | undefined) => void
  onArchive: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const task = props.task
  const start = useMutation(api.task.start.mutationOptions())
  const review = useMutation(api.task.review.mutationOptions())
  const startSession = (mode: "new" | "continue") =>
    start.mutate(
      { id: task.id, mode },
      {
        onSuccess: (started) => {
          if (started.session) props.onOpenSession(started.session.id)
        },
        onError: failed("Couldn’t start the task"),
      },
    )
  return (
    <header className="mx-8 flex h-15 shrink-0 items-center gap-2.5 border-b pt-1 text-sm max-md:pl-6">
      <Link to="/tasks" className="font-medium">
        Tasks
      </Link>
      <IconChevronRight className="size-4 text-muted-foreground" />
      {task.parent ? (
        <>
          <Link
            to="/tasks/$taskId"
            params={{ taskId: task.parent.id }}
            className="max-w-60 truncate text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            {task.parent.title}
          </Link>
          <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </>
      ) : null}
      <IconChecklist aria-label={task.identifier} className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{task.title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button className="ml-auto" aria-label={`Start a session for ${task.title}`} />}>
          <IconPlayerPlay />
          Start
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={start.isPending} onClick={() => startSession("new")}>
              <IconPlus />
              Start new session
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!task.session || start.isPending} onClick={() => startSession("continue")}>
              <IconHistory />
              Continue last session
            </DropdownMenuItem>
            {task.session ? (
              <DropdownMenuItem onClick={() => props.onOpenSession(task.session?.id)}>
                <IconMessage />
                Open session
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Actions for ${task.title}`}
            />
          }
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => props.onChange({ status: "done" })}>Mark done</DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onChange({ status: "dismissed" })}>Dismiss</DropdownMenuItem>
            <DropdownMenuItem disabled={task.agentId === null} onClick={() => props.onAssign({ agentId: null })}>
              Unassign
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={task.humanReview}
              onClick={() =>
                review.mutate(
                  { id: task.id, payload: { humanReview: true, reason: "Requested from the task page" } },
                  { onError: failed("Couldn’t request a review") },
                )
              }
            >
              Request review
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={props.onArchive}>
              Archive task
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

function TaskArticle(props: {
  task: TaskInfo
  onChange: (patch: Patch) => void
  onOpenSession: (session: string | undefined) => void
}) {
  const task = props.task
  return (
    <article className="mx-auto flex w-full max-w-200 min-w-0 flex-col gap-6 self-start pt-12 pb-24">
      <h1 className="sr-only">{task.title}</h1>
      {task.parent ? (
        <Link
          to="/tasks/$taskId"
          params={{ taskId: task.parent.id }}
          title={`Back to ${task.parent.identifier}`}
          className="-mb-3 flex h-7 w-fit max-w-full items-center gap-1.5 rounded-full border bg-muted px-2.5 text-xs text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
        >
          <IconArrowUpLeft className="size-3.5 shrink-0" />
          <IconChecklist className="size-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">{task.parent.title}</span>
        </Link>
      ) : null}
      <Textarea
        key={`title-${task.title}`}
        defaultValue={task.title}
        readOnly={!task.canUpdate}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === "Escape") {
            event.currentTarget.value = task.title
            event.currentTarget.blur()
          }
        }}
        onBlur={(event) => {
          const title = event.currentTarget.value.trim()
          if (!title) event.currentTarget.value = task.title
          else if (title !== task.title) props.onChange({ title })
        }}
        aria-label="Task title"
        className="min-h-0 shrink-0 resize-none rounded-none border-0 bg-transparent p-0 text-2xl font-semibold tracking-heading shadow-none focus-visible:ring-0 md:text-2xl dark:bg-transparent"
      />
      {task.humanReview ? <ReviewBanner task={task} onOpenSession={props.onOpenSession} /> : null}
      <TaskDescription task={task} onChange={(description) => props.onChange({ description })} />
      <Subtasks task={task} />
      <Separator />
      <TaskActivity taskId={task.id} onOpenSession={props.onOpenSession} />
    </article>
  )
}

function useReview(task: TaskInfo) {
  const { api } = RouterContext.useRouterContext()
  const review = useMutation(api.task.review.mutationOptions())
  return {
    pending: review.isPending,
    decide: (decision: "approved" | "changes_requested") =>
      review.mutate(
        { id: task.id, payload: { humanReview: false, decision } },
        { onError: failed("Couldn’t send the review") },
      ),
  }
}

function ReviewBanner(props: { task: TaskInfo; onOpenSession: (session: string | undefined) => void }) {
  const waiting = useAgents().agent(props.task.agentId)?.name ?? "Ren"
  const review = useReview(props.task)
  const session = props.task.session?.id
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card py-2.5 pr-2.5 pl-4">
      <IconHandStop className="size-4 shrink-0 text-chart-3" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{waiting} is waiting for your go-ahead</span>
      {session ? (
        <Button size="sm" variant="ghost" onClick={() => props.onOpenSession(session)}>
          See details
        </Button>
      ) : null}
      <Button size="sm" disabled={review.pending} onClick={() => review.decide("approved")}>
        <IconCheck />
        Approve
      </Button>
    </div>
  )
}

function ReviewCard(props: { task: TaskInfo }) {
  const review = useReview(props.task)
  const waiting = useAgents().agent(props.task.agentId)?.name ?? "Ren"
  return (
    <div className="flex animate-in flex-col gap-3 rounded-xl border bg-card p-4 duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:slide-in-from-bottom-0">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-chart-3">
          <IconHandStop className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{waiting} is waiting for your go-ahead</span>
          {props.task.humanReviewReason ? (
            <span className="text-sm whitespace-pre-wrap text-muted-foreground">{props.task.humanReviewReason}</span>
          ) : null}
        </div>
      </div>
      <div className="ml-11 flex gap-2">
        <Button size="sm" disabled={review.pending} onClick={() => review.decide("approved")}>
          <IconCheck />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={review.pending}
          onClick={() => review.decide("changes_requested")}
        >
          Request changes
        </Button>
      </div>
    </div>
  )
}

function Subtasks(props: { task: TaskInfo }) {
  const { api } = RouterContext.useRouterContext()
  const task = props.task
  const listed = useQuery({
    ...api.task.list.queryOptions({ parentId: task.id, includeDone: true, page: 1, pageSize: pickerPageSize }),
    refetchInterval: refreshEvery,
  })
  const subtasks = listed.data?.items ?? []
  const total = task.subtasks?.total ?? 0
  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-8 items-center justify-between">
        <h2 className="text-sm font-medium">
          Sub-tasks
          {total > 0 ? (
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              {task.subtasks?.done ?? 0}/{total}
            </span>
          ) : null}
        </h2>
        {task.canUpdate ? (
          <NewTaskDialog
            spaceId={task.spaceId}
            parent={{ id: task.id, identifier: task.identifier }}
            trigger={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
          >
            <IconPlus />
            Add sub-task
          </NewTaskDialog>
        ) : null}
      </div>
      {listed.isPending && total > 0 ? <SkeletonRows count={Math.min(total, 3)} label="Loading sub-tasks" /> : null}
      {subtasks.map((subtask) => (
        <Link
          key={subtask.id}
          to="/tasks/$taskId"
          params={{ taskId: subtask.id }}
          className="-mx-2 flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors duration-150 ease-out hover:bg-muted"
        >
          <PriorityIcon priority={subtask.priority} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{subtask.identifier}</span>
          <StatusIcon task={subtask} />
          <span className="truncate font-medium">{subtask.title}</span>
        </Link>
      ))}
    </section>
  )
}

function StatusProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <StatusMenu
      status={task.status}
      onChange={(status) => props.onChange({ status })}
      trigger={<Button variant="ghost" className={propertyButton} aria-label={`Status for ${task.title}`} />}
    >
      <StatusIcon task={task} />
      {statusOf(task.status).label}
    </StatusMenu>
  )
}

function PriorityProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <PriorityMenu
      priority={task.priority}
      onChange={(priority) => props.onChange({ priority })}
      trigger={<Button variant="ghost" className={propertyButton} aria-label={`Priority for ${task.title}`} />}
    >
      <PriorityIcon priority={task.priority} />
      {task.priority ? priorityLabelOf(task.priority) : "No priority"}
    </PriorityMenu>
  )
}

function AssigneeIcon(props: { task: TaskInfo; owner: Member | undefined }) {
  const owner = props.owner
  if (props.task.agentId) return <IconGhostFilled />
  if (owner?.name) return <PersonAvatar name={owner.name} image={owner.image} />
  return <IconUserCircle />
}

function AssigneeProperty(props: { task: TaskInfo; onAssign: (target: Assignment) => void }) {
  const task = props.task
  const owner = useMembers().member(task.ownerId)
  const assignee = useAgents().agent(task.agentId)?.name ?? owner?.name ?? null
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={cn(propertyButton, !assignee && "text-muted-foreground")}
            aria-label={`Assignee for ${task.title}`}
          />
        }
      >
        <AssigneeIcon task={task} owner={owner} />
        {assignee ?? "Unassigned"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0 p-0">
        <Command className={pickerCommand}>
          <CommandInput placeholder="Search assignee…" />
          <AssigneeList task={task} assigned={assignee !== null} onAssign={props.onAssign} />
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AssigneeList(props: { task: TaskInfo; assigned: boolean; onAssign: (target: Assignment) => void }) {
  const task = props.task
  const agents = useAgents().agents
  const members = useMembers().members
  return (
    <CommandList className="max-h-72 p-1">
      <CommandEmpty>No one matches.</CommandEmpty>
      <CommandGroup>
        <CommandItem
          className={pickerItem}
          data-checked={!props.assigned}
          onSelect={() => props.onAssign({ agentId: null, ownerId: null })}
        >
          <IconUserCircle />
          Unassigned
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Assign to an agent">
        {agents.map((agent) => (
          <CommandItem
            key={agent.id}
            className={pickerItem}
            data-checked={task.agentId === agent.id}
            onSelect={() => props.onAssign({ agentId: agent.id })}
          >
            <IconGhostFilled />
            {agent.name}
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandGroup heading="Assign to a person">
        {members.map((member) => (
          <CommandItem
            key={member.id}
            className={pickerItem}
            data-checked={task.agentId === null && task.ownerId === member.id}
            onSelect={() => props.onAssign({ agentId: null, ownerId: member.id })}
          >
            <PersonAvatar name={member.name} image={member.image} />
            {member.name}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  )
}

function DueDateProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  const set = props.onChange
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={cn(propertyButton, !task.dueAt && "text-muted-foreground")}
            aria-label={`Due date for ${task.title}`}
          />
        }
      >
        <IconCalendarDue />
        {task.dueAt ? formatDate(task.dueAt) : "Set due date"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-1 p-1.5">
        <Calendar
          mode="single"
          selected={task.dueAt ? new Date(task.dueAt) : undefined}
          onSelect={(day: Date | undefined) => set({ dueAt: day ? day.toISOString() : null })}
          className="p-0"
        />
        <Separator />
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => set({ dueAt: new Date().toISOString() })}
        >
          Today
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function LabelsProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {task.labels.map((label) => (
        <LabelBadge key={label.id} name={label.name} color={label.color} />
      ))}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className={cn(propertyButton, "text-muted-foreground", task.labels.length > 0 && "ml-0 w-8 px-0")}
              aria-label={`Labels for ${task.title}`}
            />
          }
        >
          {task.labels.length > 0 ? <IconPlus /> : <IconTag />}
          {task.labels.length > 0 ? null : "Add label"}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-0 p-1">
          <LabelPicker task={task} onChange={props.onChange} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function LabelPicker(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const labels = useLabels()
  const [query, setQuery] = useState("")
  const names = props.task.labels.map((each) => each.name)
  const typed = query.trim()
  const creatable = typed !== "" && !labels.some((label) => label.name.toLowerCase() === typed.toLowerCase())
  const toggle = (name: string) =>
    props.onChange({ labels: names.includes(name) ? names.filter((each) => each !== name) : [...names, name] })
  return (
    <Command>
      <CommandInput placeholder="Search or create labels…" value={query} onValueChange={setQuery} />
      <CommandList className="pt-1">
        {creatable ? null : <CommandEmpty>No labels match.</CommandEmpty>}
        <CommandGroup className="p-0">
          {labels.map((label) => (
            <CommandItem
              key={label.id}
              value={label.name}
              onSelect={() => toggle(label.name)}
              className="[&>svg:last-child]:hidden"
            >
              <ColorDot color={labelColor(label.color)} />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
              <Checkbox
                checked={names.includes(label.name)}
                tabIndex={-1}
                aria-hidden
                className="pointer-events-none data-checked:border-chart-1 data-checked:bg-chart-1 data-checked:text-white dark:data-checked:bg-chart-1"
              />
            </CommandItem>
          ))}
          {creatable ? (
            <CommandItem
              value={`create ${typed}`}
              onSelect={() => {
                toggle(typed)
                setQuery("")
              }}
              className="[&>svg:last-child]:hidden"
            >
              <IconPlus className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                Create <span className="font-medium">“{typed}”</span>
              </span>
            </CommandItem>
          ) : null}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function CreatedInProperty(props: { sessionId: string; onOpenSession: (session: string | undefined) => void }) {
  const { api } = RouterContext.useRouterContext()
  const session = useQuery({ ...api.session.get.queryOptions({ idOrSlug: props.sessionId }), retry: false })
  return (
    <Button
      variant="ghost"
      className={cn(propertyButton, "max-w-full")}
      aria-label="Open the session that created this task"
      onClick={() => props.onOpenSession(props.sessionId)}
    >
      <IconMessage />
      <span className="truncate">{session.data?.title ?? "Session"}</span>
    </Button>
  )
}

function SpaceProperty(props: { task: TaskInfo; onAssign: (target: Assignment) => void }) {
  const spaces = useSpaces()
  const task = props.task
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={cn(propertyButton, "font-medium")}
            aria-label={`Space for ${task.title}`}
          />
        }
      >
        <IconCube />
        {spaces.spaceName(task.spaceId)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0 p-0">
        <Command className={pickerCommand}>
          <CommandInput placeholder="Search space…" />
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">Moving a task does not start work.</p>
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No spaces match.</CommandEmpty>
            <CommandGroup heading="Move to a space">
              {spaces.spaces.map((space) => (
                <CommandItem
                  key={space.id}
                  className={pickerItem}
                  data-checked={task.spaceId === space.id}
                  onSelect={() => props.onAssign({ spaceId: space.id })}
                >
                  <IconCube />
                  {space.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
