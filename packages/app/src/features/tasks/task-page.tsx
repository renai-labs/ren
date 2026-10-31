import { useState, type ReactNode } from "react"
import type { TaskInfo, TaskUpdateInput } from "@ren/client"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import {
  IconAlertCircle,
  IconCalendar,
  IconChevronRight,
  IconCube,
  IconDots,
  IconHistory,
  IconMessage,
  IconPlayerPlay,
  IconPlus,
  IconGhost,
  IconSquare,
  IconSquareCheckFilled,
  IconUserCircle,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Calendar } from "@ren/ui/calendar"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  priorities,
  priorityLabelOf,
  statusOf,
  statuses,
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
import { TaskActivity } from "./task-activity.js"
import { TaskLinks } from "./task-links.js"
import { cn } from "cn"

const propertyButton =
  "-ml-2 h-8 w-fit justify-start gap-2 px-2 font-normal [&_svg:not([class*='text-'])]:text-muted-foreground"

const pickerCommand =
  "rounded-none! **:data-[slot=input-group]:h-14! **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:uppercase"
const pickerItem = "h-11 gap-3 rounded-lg px-3"

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

export function TaskPage(props: { session: ReactNode }) {
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
        <TaskArticle task={task} onChange={change} />
        <aside aria-label="Task properties" className="flex w-70 shrink-0 flex-col gap-6 pt-12">
          <PropertySection title="Properties">
            <StatusProperty task={task} onChange={change} />
            <PriorityProperty task={task} onChange={change} />
            <AssigneeProperty task={task} onAssign={reassign} />
            <DueDateProperty task={task} onChange={change} />
          </PropertySection>
          <PropertySection title="Labels">
            <LabelsProperty task={task} onChange={change} />
          </PropertySection>
          <PropertySection title="Space">
            <SpaceProperty task={task} onAssign={reassign} />
          </PropertySection>
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
          <div className="flex min-h-0 flex-1 flex-col">{props.session}</div>
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
    <header className="mx-8 flex h-11.5 shrink-0 items-center gap-2 border-b text-sm group-has-[[data-slot=sidebar][data-state=collapsed]]/sidebar-wrapper:pl-6 max-md:pl-6">
      <Link to="/tasks" className="font-medium">
        Tasks
      </Link>
      <IconChevronRight className="size-4 text-muted-foreground" />
      <span className="font-mono text-xs text-muted-foreground">{task.identifier}</span>
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

function TaskArticle(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <article className="mx-auto flex w-full max-w-200 min-w-0 flex-col gap-6 pt-12 pb-16">
      <h1 className="sr-only">{task.title}</h1>
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
        className="min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-2xl font-semibold tracking-heading shadow-none focus-visible:ring-0 md:text-2xl dark:bg-transparent"
      />
      {task.humanReview ? <ReviewBanner task={task} /> : null}
      <Textarea
        key={`description-${task.description ?? ""}`}
        defaultValue={task.description ?? ""}
        readOnly={!task.canUpdate}
        onBlur={(event) => {
          const description = event.currentTarget.value.trim()
          if (description !== (task.description ?? "")) props.onChange({ description: description || null })
        }}
        placeholder="Add description…"
        aria-label="Task description"
        className="min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-md/6 shadow-none focus-visible:ring-0 md:text-md/6 dark:bg-transparent"
      />
      <Subtasks task={task} />
      {task.links.length > 0 ? <TaskLinks links={task.links} /> : null}
      <Separator />
      <TaskActivity taskId={task.id} />
    </article>
  )
}

function ReviewBanner(props: { task: TaskInfo }) {
  const { api } = RouterContext.useRouterContext()
  const review = useMutation(api.task.review.mutationOptions())
  const decide = (decision: "approved" | "changes_requested") =>
    review.mutate(
      { id: props.task.id, payload: { humanReview: false, decision } },
      { onError: failed("Couldn’t send the review") },
    )
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
      <IconAlertCircle className="mt-0.5 size-4 text-chart-3" />
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-medium">Needs your review</span>
        {props.task.humanReviewReason ? (
          <span className="text-sm text-muted-foreground">{props.task.humanReviewReason}</span>
        ) : null}
      </div>
      <Button variant="ghost" onClick={() => decide("changes_requested")}>
        Request changes
      </Button>
      <Button onClick={() => decide("approved")}>Approve</Button>
    </div>
  )
}

function Subtasks(props: { task: TaskInfo }) {
  const { api } = RouterContext.useRouterContext()
  const task = props.task
  const subtasks =
    useQuery({
      ...api.task.list.queryOptions({ parentId: task.id, includeDone: true, page: 1, pageSize: pickerPageSize }),
      refetchInterval: refreshEvery,
    }).data?.items ?? []
  if (subtasks.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        Subtasks · {task.subtasks?.done ?? 0} of {task.subtasks?.total ?? subtasks.length} done
      </h2>
      {subtasks.map((subtask) => (
        <Link
          key={subtask.id}
          to="/tasks/$taskId"
          params={{ taskId: subtask.id }}
          className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted"
        >
          <StatusIcon task={subtask} />
          <span className="font-mono text-xs text-muted-foreground">{subtask.identifier}</span>
          {subtask.title}
        </Link>
      ))}
    </section>
  )
}

function StatusProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className={propertyButton} aria-label={`Status for ${task.title}`} />}
      >
        <StatusIcon task={task} />
        {statusOf(task.status).label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuRadioGroup
          value={task.status}
          onValueChange={(status: string) => {
            if (status === "todo" || status === "in_progress" || status === "done" || status === "dismissed")
              props.onChange({ status })
          }}
        >
          {Object.entries(statuses).map((entry) => (
            <DropdownMenuRadioItem key={entry[0]} value={entry[0]}>
              {entry[1].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PriorityProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className={propertyButton} aria-label={`Priority for ${task.title}`} />}
      >
        <PriorityIcon priority={task.priority} />
        {task.priority ? priorityLabelOf(task.priority) : "No priority"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuRadioGroup
          value={task.priority ?? "none"}
          onValueChange={(priority: string) =>
            props.onChange({
              priority: priority === "high" || priority === "medium" || priority === "low" ? priority : null,
            })
          }
        >
          {[["none", "No priority"], ...Object.entries(priorities)].map((entry) => (
            <DropdownMenuRadioItem key={entry[0]} value={entry[0]}>
              {entry[1]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AssigneeIcon(props: { task: TaskInfo; owner: Member | undefined }) {
  const owner = props.owner
  if (props.task.agentId) return <IconGhost />
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
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <Command className={pickerCommand}>
          <CommandInput placeholder="Search assignee…" className="text-base" />
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
    <CommandList className="max-h-80 p-1">
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
            <IconGhost />
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
        <IconCalendar />
        {task.dueAt ? formatDate(task.dueAt) : "Set due date"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-3">
        <Calendar
          mode="single"
          selected={task.dueAt ? new Date(task.dueAt) : undefined}
          onSelect={(day: Date | undefined) => set({ dueAt: day ? day.toISOString() : null })}
          className="w-full p-0"
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
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Labels for ${task.title}`}
            />
          }
        >
          <IconPlus />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-0 p-1">
          <Command>
            <CommandInput placeholder="Search or create labels…" />
            <LabelList task={task} onChange={props.onChange} />
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function LabelList(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const labels = useLabels()
  const names = props.task.labels.map((each) => each.name)
  return (
    <CommandList className="pt-1">
      <CommandEmpty>No labels match.</CommandEmpty>
      <CommandGroup className="p-0">
        {labels.map((label) => {
          const checked = names.includes(label.name)
          return (
            <CommandItem
              key={label.id}
              data-checked={checked}
              onSelect={() =>
                props.onChange({
                  labels: checked ? names.filter((name) => name !== label.name) : [...names, label.name],
                })
              }
            >
              {checked ? <IconSquareCheckFilled /> : <IconSquare className="text-muted-foreground" />}
              <ColorDot color={labelColor(label.color)} />
              {label.name}
            </CommandItem>
          )
        })}
      </CommandGroup>
    </CommandList>
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
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <Command className={pickerCommand}>
          <CommandInput placeholder="Search space…" className="text-base" />
          <p className="-mx-1 border-b px-4 py-2 text-xs text-muted-foreground">Moving a task does not start work.</p>
          <CommandList className="max-h-80 p-1">
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
