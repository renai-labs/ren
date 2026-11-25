import { Seed, Tasks } from "@ren/client/react"
import { SessionSheet } from "../../components/session-sheet.js"
import { SkeletonRows } from "../../components/page.js"
import { Breadcrumb } from "../../components/breadcrumb.js"
import { useId, useRef, useState, type ReactNode, type RefObject } from "react"
import type { TaskInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import {
  IconAlertTriangle,
  IconArchive,
  IconCalendarDue,
  IconCheck,
  IconCopy,
  IconCube,
  IconDots,
  IconHandStop,
  IconHistory,
  IconMessage,
  IconPlayerPlay,
  IconPlus,
  IconSubtask,
  IconTag,
} from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { useCopy } from "../../lib/use-copy.js"
import { useNow } from "../../lib/use-now.js"
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
import { Textarea } from "@ren/ui/textarea"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Markdown } from "../../components/markdown.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import {
  LabelBadge,
  PriorityIcon,
  StatusIcon,
  UnassignedIcon,
  priorityLabelOf,
  statusOf,
} from "../../components/task-meta.js"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { formatDate } from "@ren/ui/time"
import { pickerPageSize } from "../../lib/pagination.js"
import { RouterContext } from "../../lib/router-context.js"
import { TaskLink, TasksLink } from "./task-scope.js"
import { TaskScopeContext } from "./task-scope-context.js"
import { useAgents } from "../../lib/use-agents.js"
import { IconAgent } from "../../icons/heroicons.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { useMembers } from "../../lib/use-members.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { DriveSpace } from "../../components/drive-file.js"
import { TaskDescription } from "./task-description.js"
import { LabelPicker } from "../../components/label-picker.js"
import { DueDatePicker } from "../../components/due-date-picker.js"
import { SpacePicker } from "../../components/space-picker.js"
import { TaskAgentPicker, TaskPersonPicker } from "../../components/assignee-picker.js"
import { SubtaskProgress, TaskRow } from "./task-row.js"
import { TaskDisplay } from "./task-display.js"
import { Preference } from "../../lib/preference.js"
import type { Assignee } from "../../components/assignee.js"
import { Picker } from "../../components/picker.js"
import { TaskActivity } from "./task-activity.js"
import { TaskActions } from "./task-actions.js"
import { TaskLinkSections } from "./task-links.js"
import { PriorityMenu, StatusMenu } from "../../components/task-pickers.js"
import { SubtaskComposer } from "../../components/new-task-dialog.js"
import { cn } from "cn"
import { TaskLayout } from "../../components/task-layout.js"

function ReadOnlyProperty(props: { children: ReactNode; className?: string | undefined }) {
  return (
    <div
      className={cn(buttonVariants({ variant: "ghost" }), TaskLayout.property, "pointer-events-none", props.className)}
    >
      {props.children}
    </div>
  )
}

function PropertySection(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className={TaskLayout.sectionTitle}>{props.title}</h2>
      {props.children}
    </section>
  )
}

type Patch = Tasks.Patch

export function TaskPage(props: {
  taskId: string
  sessionId: string | undefined
  onOpenSession: (session: string | undefined) => void
  session: ((dock: ReactNode) => ReactNode) | null
}) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const open = TaskScopeContext.useOpen()
  const openSession = props.onOpenSession
  const stored = useSuspenseQuery({
    ...api.task.get.queryOptions({ idOrSlug: props.taskId }),
    refetchInterval: Tasks.refreshEvery,
    ...Seed.fromList<TaskInfo>(queryClient, [api.task.list.queryKey(), Tasks.allKey()], props.taskId),
  }).data
  const update = useMutation(api.task.update.mutationOptions())
  const assign = useMutation(api.task.assign.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const [archiving, setArchiving] = useState(false)
  const menu = useRef<HTMLButtonElement>(null)
  const task = Tasks.withPatch(stored, update.isPending ? update.variables : undefined)
  const change = (patch: Patch) =>
    update.mutate({ id: task.id, ...patch }, { onError: TaskActions.failed("Couldn’t save the task") })
  const reassign = (target: Assignee.Assignment) =>
    assign.mutate(
      { id: task.id, start: "none", ...target },
      { onError: TaskActions.failed("Couldn’t reassign the task") },
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskHeader task={task} menu={menu} onOpenSession={openSession} onArchive={() => setArchiving(true)} />
      <div className={TaskLayout.scroller}>
        <div className={TaskLayout.body}>
          <TaskArticle task={task} onChange={change} onOpenSession={openSession} />
          <aside aria-label="Task properties" className={TaskLayout.aside}>
            <PropertySection title="Properties">
              <StatusProperty task={task} onChange={change} />
              <PriorityProperty task={task} onChange={change} />
              <AgentProperty task={task} onAssign={reassign} />
              <PersonProperty task={task} onAssign={reassign} />
              <DueDateProperty task={task} onChange={change} />
            </PropertySection>
            <LinksProperty task={task} onChange={change} />
            <PropertySection title="Labels">
              <LabelsProperty task={task} onChange={change} />
            </PropertySection>
            <PropertySection title="Space">
              <SpaceProperty task={task} onAssign={reassign} />
            </PropertySection>
            <PropertySection title="Parent">
              <ParentProperty task={task} onChange={change} />
            </PropertySection>
            {task.createdBy.sessionId ? (
              <PropertySection title="Created in chat">
                <CreatedInProperty sessionId={task.createdBy.sessionId} onOpenSession={openSession} />
              </PropertySection>
            ) : null}
          </aside>
        </div>
      </div>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        finalFocus={menu}
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
                open.tasks()
              },
              onError: TaskActions.failed("Couldn’t archive the task"),
            },
          )
        }
      />
      <SessionSheet
        open={props.sessionId !== undefined}
        onClose={() => openSession(undefined)}
        title="Task session"
        description="Chat with the agent working on this task."
      >
        {props.session?.(task.humanReview ? <ReviewCard task={task} /> : null)}
      </SessionSheet>
    </div>
  )
}

function RequestReview(props: { task: TaskInfo; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { api } = RouterContext.useRouterContext()
  const review = useMutation(api.task.review.mutationOptions())
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  const id = useId()
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a review of {props.task.identifier}</DialogTitle>
          <DialogDescription>
            The task shows Needs review until a person approves it or asks for changes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!reason.trim()) return setMissing(true)
            review.mutate(
              { id: props.task.id, payload: { humanReview: true, reason: reason.trim() } },
              {
                onSuccess: () => {
                  setReason("")
                  props.onOpenChange(false)
                },
                onError: TaskActions.failed("Couldn’t request a review"),
              },
            )
          }}
        >
          <Field data-invalid={missing || undefined}>
            <FieldLabel htmlFor={`${id}-reason`}>What should the reviewer look at?</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              className="min-h-24"
              placeholder="Check the rollback plan before the migration runs."
              aria-invalid={missing || undefined}
              aria-describedby={missing ? id : undefined}
              onChange={(event) => {
                setReason(event.target.value)
                setMissing(false)
              }}
            />
            {missing ? <FieldError id={id}>Say what to review.</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={review.isPending}>
              Request review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ParentProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  const parent = task.parent
  if (!task.canUpdate)
    return (
      <ReadOnlyProperty className={cn(!parent && "text-muted-foreground")}>
        <IconSubtask />
        <span className="truncate">{parent ? parent.title : "No parent"}</span>
      </ReadOnlyProperty>
    )
  if ((task.subtasks?.total ?? 0) > 0)
    return <p className="px-2 text-sm text-muted-foreground">A task with sub-tasks stays at the top level.</p>
  return <ParentPicker task={task} onChange={props.onChange} />
}

function ParentPicker(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const { api } = RouterContext.useRouterContext()
  const task = props.task
  const [query, setQuery] = useState("")
  const search = query.trim()
  const [open, setOpen] = useState(false)
  const roots =
    useQuery({
      ...api.task.list.queryOptions({
        spaceId: task.spaceId,
        parentId: "none",
        includeDone: true,
        ...(search && { search }),
        page: 1,
        pageSize: pickerPageSize,
      }),
      enabled: open,
      placeholderData: keepPreviousData,
    }).data?.items ?? []
  const parent = task.parent
  const choose = (parentId: string | null) => {
    setOpen(false)
    props.onChange({ parentId })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={cn(TaskLayout.property, !parent && "text-muted-foreground")}
            aria-label={parent ? `Parent: ${parent.title}` : "Set parent"}
          />
        }
      >
        <IconSubtask />
        <span className="truncate">{parent ? parent.title : "Set parent"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <Command label="Parent" shouldFilter={false} defaultValue={parent?.id ?? "none"} className={Picker.command}>
          <CommandInput placeholder="Search tasks…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No task matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none"
                keywords={["No parent"]}
                className={cn("gap-2", search && "hidden")}
                data-checked={!parent}
                onSelect={() => choose(null)}
              >
                No parent
              </CommandItem>
              {roots
                .filter((each) => each.id !== task.id)
                .map((each) => (
                  <CommandItem
                    key={each.id}
                    value={each.id}
                    keywords={[each.identifier, each.title]}
                    className="gap-2"
                    data-checked={parent?.id === each.id}
                    onSelect={() => choose(each.id)}
                  >
                    <StatusIcon task={each} />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{each.identifier}</span>
                    <span className="truncate">{each.title}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SessionState(props: { state: string | undefined }) {
  if (props.state === "working")
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        Working
      </span>
    )
  if (props.state === "failed")
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <IconAlertTriangle className="size-3.5" />
        Last run failed
      </span>
    )
  return null
}

function StartMenu(props: { task: TaskInfo; onOpenSession: (session: string | undefined) => void }) {
  const { api } = RouterContext.useRouterContext()
  const task = props.task
  const start = useMutation(api.task.start.mutationOptions())
  const startSession = (mode: "new" | "continue") =>
    start.mutate(
      { id: task.id, mode },
      {
        onSuccess: (started) => {
          if (started.session) props.onOpenSession(started.session.id)
        },
        onError: TaskActions.failed("Couldn’t start the task"),
      },
    )
  const state = task.session?.state
  const quiet = state === "working" || task.status === "done" || task.status === "dismissed"
  const status = <SessionState state={state} />
  if (!task.canUpdate && !task.session) return <span className="ml-auto" />
  if (!task.canUpdate)
    return (
      <div className="ml-auto flex items-center gap-3">
        {status}
        <Button variant="outline" onClick={() => props.onOpenSession(task.session?.id)}>
          <IconMessage />
          Open session
        </Button>
      </div>
    )
  return (
    <div className="ml-auto flex items-center gap-3">
      {status}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant={quiet ? "outline" : "default"} aria-label={`Start a session for ${task.title}`} />}
        >
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
    </div>
  )
}

function TaskHeader({
  menu,
  ...props
}: {
  task: TaskInfo
  menu: RefObject<HTMLButtonElement | null>
  onOpenSession: (session: string | undefined) => void
  onArchive: () => void
}) {
  const task = props.task
  const copy = useCopy()
  const [requesting, setRequesting] = useState(false)
  return (
    <Breadcrumb.Header className={TaskLayout.header}>
      <Breadcrumb.Root
        ancestors={[
          { key: "tasks", content: <TasksLink>Tasks</TasksLink> },
          ...(task.parent
            ? [
                {
                  key: task.parent.id,
                  className: "max-sm:hidden",
                  content: (
                    <TaskLink taskId={task.parent.id} title={task.parent.title}>
                      <span className="max-w-32 truncate sm:max-w-60">{task.parent.title}</span>
                    </TaskLink>
                  ),
                },
              ]
            : []),
        ]}
      >
        <IconSubtask aria-label={task.identifier} className="size-4 shrink-0" />
        <span className="truncate">{task.title}</span>
      </Breadcrumb.Root>
      <StartMenu task={task} onOpenSession={props.onOpenSession} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={menu}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Actions for ${task.title}`}
            />
          }
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            {copy ? (
              <DropdownMenuItem onClick={() => copy(task.identifier, `${task.identifier} copied`)}>
                <IconCopy />
                Copy ID
              </DropdownMenuItem>
            ) : null}
            {task.canUpdate ? (
              <>
                <DropdownMenuItem disabled={task.humanReview} onClick={() => setRequesting(true)}>
                  <IconHandStop />
                  Request review
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={props.onArchive}>
                  <IconArchive />
                  Archive task
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <RequestReview task={task} open={requesting} onOpenChange={setRequesting} />
    </Breadcrumb.Header>
  )
}

function ParentLine(props: { parent: NonNullable<TaskInfo["parent"]> }) {
  const { api } = RouterContext.useRouterContext()
  const parent = useQuery(api.task.get.queryOptions({ idOrSlug: props.parent.id })).data
  const progress = parent?.subtasks
  return (
    <p className="-mt-4 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <span className="shrink-0">Sub-task of</span>
      <TaskLink
        taskId={props.parent.id}
        title={`Open ${props.parent.identifier}`}
        className="flex min-w-0 items-center gap-1.5 rounded-md text-foreground transition-colors duration-150 ease-out hover:text-foreground/80"
      >
        {parent ? <StatusIcon task={parent} /> : null}
        <span className="shrink-0 text-muted-foreground tabular-nums">{props.parent.identifier}</span>
        <span className="truncate font-medium">{props.parent.title}</span>
      </TaskLink>
      {progress && progress.total > 0 ? (
        <SubtaskProgress done={progress.done} total={progress.total} className="shrink-0 bg-transparent" />
      ) : null}
    </p>
  )
}

function TaskArticle(props: {
  task: TaskInfo
  onChange: (patch: Patch) => void
  onOpenSession: (session: string | undefined) => void
}) {
  const task = props.task
  return (
    <DriveSpace value={task.spaceId}>
      <article className={TaskLayout.article}>
        <h1 className="sr-only">{task.title}</h1>
        <Textarea
          key={`title-${task.title}`}
          defaultValue={task.title}
          readOnly={!task.canUpdate}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
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
          className="min-h-0 shrink-0 resize-none rounded-none border-0 bg-transparent p-0 text-2xl font-semibold tracking-heading wrap-break-word shadow-none focus-visible:ring-0 md:text-2xl dark:bg-transparent"
        />
        {task.parent ? <ParentLine parent={task.parent} /> : null}
        {task.humanReview ? <ReviewBanner task={task} onOpenSession={props.onOpenSession} /> : null}
        <TaskDescription task={task} onChange={(description) => props.onChange({ description })} />
        <Subtasks task={task} />
        <Separator />
        <TaskActivity task={task} onOpenSession={props.onOpenSession} />
      </article>
    </DriveSpace>
  )
}

function useReview(task: TaskInfo) {
  const { api } = RouterContext.useRouterContext()
  const review = useMutation(api.task.review.mutationOptions())
  return {
    pending: review.isPending,
    approve: () =>
      review.mutate(
        { id: task.id, payload: { humanReview: false, decision: "approved" } },
        { onError: TaskActions.failed("Couldn’t send the review") },
      ),
    requestChanges: (comment: string, onSent: () => void) =>
      review.mutate(
        { id: task.id, payload: { humanReview: false, decision: "changes_requested", comment } },
        { onSuccess: onSent, onError: TaskActions.failed("Couldn’t send the review") },
      ),
  }
}

type Review = ReturnType<typeof useReview>

function useWaiting(task: TaskInfo) {
  const agent = useAgents().agent(task.agentId)?.name
  const who = task.canUpdate ? "your go-ahead" : "a review"
  return agent ? `${agent} is waiting for ${who}` : `Waiting for ${who}`
}

function RequestChanges(props: { review: Review }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [missing, setMissing] = useState(false)
  const errorId = useId()
  const send = () => {
    if (!note.trim()) return setMissing(true)
    props.review.requestChanges(note.trim(), () => {
      setOpen(false)
      setNote("")
    })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="sm" variant="outline" disabled={props.review.pending} />}>
        Request changes
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          <Field data-invalid={missing || undefined}>
            <FieldLabel htmlFor={`${errorId}-note`}>What should change?</FieldLabel>
            <Textarea
              id={`${errorId}-note`}
              value={note}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? errorId : undefined}
              placeholder="Keep the existing index name."
              className="min-h-24"
              onChange={(event) => {
                setNote(event.target.value)
                setMissing(false)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return
                event.preventDefault()
                send()
              }}
            />
            {missing ? <FieldError id={errorId}>Say what to change.</FieldError> : null}
          </Field>
          <Button type="submit" size="sm" className="self-end" disabled={props.review.pending}>
            Send to agent
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function ReviewReason(props: { task: TaskInfo; className?: string }) {
  if (!props.task.humanReviewReason) return null
  return (
    <Markdown source="user" className={cn("text-sm text-muted-foreground", props.className)}>
      {props.task.humanReviewReason}
    </Markdown>
  )
}

function ReviewBanner(props: { task: TaskInfo; onOpenSession: (session: string | undefined) => void }) {
  const waiting = useWaiting(props.task)
  const review = useReview(props.task)
  const session = props.task.session?.id
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card py-2.5 pr-2.5 pl-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IconHandStop className="size-4 shrink-0 text-chart-3" />
        <span className="min-w-0 grow basis-56 text-sm font-medium [overflow-wrap:anywhere]">{waiting}</span>
        <div className="ml-7 flex gap-2">
          {session ? (
            <Button size="sm" variant="ghost" onClick={() => props.onOpenSession(session)}>
              See details
            </Button>
          ) : null}
          {props.task.canUpdate ? (
            <>
              <RequestChanges review={review} />
              <Button size="sm" disabled={review.pending} onClick={review.approve}>
                <IconCheck />
                Approve
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <ReviewReason task={props.task} className="pr-2 pl-7" />
    </div>
  )
}

function ReviewCard(props: { task: TaskInfo }) {
  const review = useReview(props.task)
  const waiting = useWaiting(props.task)
  return (
    <div className="flex animate-in flex-col gap-3 rounded-xl border bg-card p-4 duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:slide-in-from-bottom-0">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-chart-3">
          <IconHandStop className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{waiting}</span>
          <ReviewReason task={props.task} />
        </div>
      </div>
      {props.task.canUpdate ? (
        <div className="ml-11 flex gap-2">
          <Button size="sm" disabled={review.pending} onClick={review.approve}>
            <IconCheck />
            Approve
          </Button>
          <RequestChanges review={review} />
        </div>
      ) : null}
    </div>
  )
}

function Subtasks(props: { task: TaskInfo }) {
  const task = props.task
  if (task.parentId || ((task.subtasks?.total ?? 0) === 0 && !task.canUpdate)) return null
  return <SubtaskList task={task} />
}

function SubtasksHeader(props: { task: TaskInfo; adding: boolean; onAdd: () => void }) {
  const total = props.task.subtasks?.total ?? 0
  return (
    <div className="flex h-8 items-center justify-between">
      <h2 className="text-sm font-medium">
        Sub-tasks
        {total > 0 ? (
          <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
            {props.task.subtasks?.done ?? 0}/{total}
          </span>
        ) : null}
      </h2>
      {props.task.canUpdate ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-expanded={props.adding}
          onClick={props.onAdd}
        >
          <IconPlus />
          Add sub-task
        </Button>
      ) : null}
    </div>
  )
}

function SubtaskList(props: { task: TaskInfo }) {
  const { api } = RouterContext.useRouterContext()
  const task = props.task
  const listed = useQuery({
    ...api.task.list.queryOptions(Tasks.subtasksInput(task.id)),
    refetchInterval: Tasks.refreshEvery,
  })
  const subtasks = listed.data?.items ?? []
  const total = task.subtasks?.total ?? 0
  const display = Preference.usePreference(TaskDisplay.preference)
  const properties = TaskDisplay.scoped(display, task.spaceId).properties
  const idWidth = Math.max(0, ...subtasks.map((subtask) => subtask.identifier.length)) + 1
  const agents = useAgents()
  const members = useMembers()
  const spaces = useSpaces()
  const [adding, setAdding] = useState(false)
  return (
    <section className="flex flex-col gap-1">
      <SubtasksHeader task={task} adding={adding} onAdd={() => setAdding(true)} />
      {listed.isPending && total > 0 ? <SkeletonRows count={Math.min(total, 3)} label="Loading sub-tasks" /> : null}
      {listed.isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn’t load the sub-tasks.{" "}
          <Button variant="link" className="h-auto p-0" onClick={() => void listed.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
      <div className="@container/tasks -mx-2 flex flex-col">
        {subtasks.map((subtask) => (
          <TaskRow
            key={subtask.id}
            task={subtask}
            show={properties}
            selected={false}
            idWidth={idWidth}
            agentName={agents.agent(subtask.agentId)?.name ?? null}
            spaceName={spaces.spaceName(subtask.spaceId)}
            owner={members.member(subtask.ownerId)}
          />
        ))}
      </div>
      {adding ? (
        <SubtaskComposer
          parent={{ id: task.id, identifier: task.identifier }}
          spaceId={task.spaceId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  )
}

function StatusProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  const content = (
    <>
      <StatusIcon task={task} />
      {statusOf(task.status).label}
    </>
  )
  if (!task.canUpdate) return <ReadOnlyProperty>{content}</ReadOnlyProperty>
  return (
    <StatusMenu
      status={task.status}
      onChange={(status) => props.onChange({ status })}
      trigger={
        <Button variant="ghost" className={TaskLayout.property} aria-label={`Status: ${statusOf(task.status).label}`} />
      }
    >
      {content}
    </StatusMenu>
  )
}

function PriorityProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  const content = (
    <>
      <PriorityIcon priority={task.priority} />
      {task.priority ? priorityLabelOf(task.priority) : "No priority"}
    </>
  )
  if (!task.canUpdate) return <ReadOnlyProperty>{content}</ReadOnlyProperty>
  return (
    <PriorityMenu
      priority={task.priority}
      onChange={(priority) => props.onChange({ priority })}
      trigger={
        <Button
          variant="ghost"
          className={TaskLayout.property}
          aria-label={`Priority: ${task.priority ? priorityLabelOf(task.priority) : "No priority"}`}
        />
      }
    >
      {content}
    </PriorityMenu>
  )
}

function AgentProperty(props: { task: TaskInfo; onAssign: (target: Assignee.Assignment) => void }) {
  const task = props.task
  const name = useAgents().agent(task.agentId)?.name ?? null
  const content = (
    <>
      <IconAgent />
      <span className="truncate">{name ?? "No agent"}</span>
    </>
  )
  if (!task.canUpdate)
    return <ReadOnlyProperty className={cn(!name && "text-muted-foreground")}>{content}</ReadOnlyProperty>
  return (
    <TaskAgentPicker
      value={task.agentId}
      spaceId={task.spaceId}
      onChange={(agentId) => props.onAssign({ agentId })}
      trigger={
        <Button
          variant="ghost"
          className={cn(TaskLayout.property, !name && "text-muted-foreground")}
          aria-label={`Agent: ${name ?? "No agent"}`}
        />
      }
    >
      {content}
    </TaskAgentPicker>
  )
}

function PersonProperty(props: { task: TaskInfo; onAssign: (target: Assignee.Assignment) => void }) {
  const task = props.task
  const owner = useMembers().member(task.ownerId)
  const content = (
    <>
      {owner ? <PersonAvatar name={owner.name} image={owner.image} /> : <UnassignedIcon />}
      <span className="truncate">{owner?.name ?? "No assignee"}</span>
    </>
  )
  if (!task.canUpdate)
    return <ReadOnlyProperty className={cn(!owner && "text-muted-foreground")}>{content}</ReadOnlyProperty>
  return (
    <TaskPersonPicker
      value={task.ownerId}
      onChange={(ownerId) => props.onAssign({ ownerId })}
      trigger={
        <Button
          variant="ghost"
          className={cn(TaskLayout.property, !owner && "text-muted-foreground")}
          aria-label={`Assignee: ${owner?.name ?? "No assignee"}`}
        />
      }
    >
      {content}
    </TaskPersonPicker>
  )
}

function DueDateProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  const overdue = TaskActions.overdue(task, useNow())
  const icon = overdue ? <IconAlertTriangle className="text-destructive" /> : <IconCalendarDue />
  if (!task.canUpdate)
    return (
      <ReadOnlyProperty className={cn(!task.dueAt && "text-muted-foreground", overdue && "text-destructive")}>
        {icon}
        {task.dueAt ? formatDate(task.dueAt) : "No due date"}
        {overdue ? <span className="sr-only">, overdue</span> : null}
      </ReadOnlyProperty>
    )
  return (
    <DueDatePicker
      value={task.dueAt}
      onChange={(dueAt) => props.onChange({ dueAt })}
      trigger={
        <Button
          variant="ghost"
          className={cn(TaskLayout.property, !task.dueAt && "text-muted-foreground", overdue && "text-destructive")}
          aria-label={task.dueAt ? `Due date: ${formatDate(task.dueAt)}${overdue ? ", overdue" : ""}` : "Set due date"}
        />
      }
    >
      {icon}
      {task.dueAt ? formatDate(task.dueAt) : "Set due date"}
    </DueDatePicker>
  )
}

function LabelsProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const task = props.task
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {task.labels.map((label) => (
        <LabelBadge key={label.id} name={label.name} color={label.color} />
      ))}
      {task.canUpdate ? (
        <LabelPicker
          value={task.labels.map((label) => label.name)}
          spaceId={task.spaceId}
          onChange={(labels) => props.onChange({ labels })}
          trigger={
            <Button
              variant="ghost"
              className={cn(TaskLayout.property, "text-muted-foreground", task.labels.length > 0 && "ml-0 w-8 px-0")}
              aria-label="Add label"
            />
          }
        >
          {task.labels.length > 0 ? <IconPlus /> : <IconTag />}
          {task.labels.length > 0 ? null : "Add label"}
        </LabelPicker>
      ) : null}
      {!task.canUpdate && task.labels.length === 0 ? (
        <span className="text-sm text-muted-foreground">No labels</span>
      ) : null}
    </div>
  )
}

function LinksProperty(props: { task: TaskInfo; onChange: (patch: Patch) => void }) {
  const { api } = RouterContext.useRouterContext()
  const pullRequests = useQuery({
    ...api.link.task.pullRequests.queryOptions({ id: props.task.id }),
    enabled: props.task.links.some((link) => link.kind === "github_pr"),
  })
  return (
    <TaskLinkSections
      links={props.task.links}
      pullRequests={pullRequests.data}
      edit={
        props.task.canUpdate
          ? {
              onAdd: (url) => props.onChange({ addLinks: [url] }),
              onRemove: (link) => props.onChange({ removeLinks: [link.id] }),
            }
          : undefined
      }
    />
  )
}

function CreatedInProperty(props: { sessionId: string; onOpenSession: (session: string | undefined) => void }) {
  const { api } = RouterContext.useRouterContext()
  const session = useQuery({ ...api.session.get.queryOptions({ idOrSlug: props.sessionId }), retry: false })
  return (
    <Button
      variant="ghost"
      className={cn(TaskLayout.property, "max-w-full")}
      aria-label="Open the chat that created this task"
      onClick={() => props.onOpenSession(props.sessionId)}
    >
      <IconMessage />
      <span className={cn("truncate", !session.data && "text-muted-foreground")}>
        {session.data?.title ?? (session.isError ? "Chat unavailable" : "Loading chat…")}
      </span>
    </Button>
  )
}

function SpaceProperty(props: { task: TaskInfo; onAssign: (target: Assignee.Assignment) => void }) {
  const spaces = useSpaces()
  const task = props.task
  if (!task.canUpdate)
    return (
      <ReadOnlyProperty className="font-medium">
        <IconCube />
        <span className="truncate">{spaces.spaceName(task.spaceId)}</span>
      </ReadOnlyProperty>
    )
  return (
    <SpacePicker
      value={task.spaceId}
      heading="Move to a space"
      note="Moving a task does not start work."
      onChange={(spaceId) => props.onAssign({ spaceId })}
      trigger={
        <Button
          variant="ghost"
          className={cn(TaskLayout.property, "font-medium")}
          aria-label={`Space: ${spaces.spaceName(task.spaceId)}`}
        />
      }
    >
      <IconCube />
      <span className="truncate">{spaces.spaceName(task.spaceId)}</span>
    </SpacePicker>
  )
}
