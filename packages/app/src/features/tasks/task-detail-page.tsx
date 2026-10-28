import type { TaskInfo } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Alert, AlertDescription } from "@ren/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
import { Spinner } from "@ren/ui/spinner"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { TaskActivity } from "./task-activity.js"
import { AttentionNotice, AttentionTurn } from "./task-attention.js"
import {
  AgentControl,
  DueDateControl,
  LabelsControl,
  OwnerControl,
  ParentControl,
  PriorityControl,
  StatusControl,
} from "./task-controls.js"
import { TaskView } from "./task-view.js"
import { TaskReview } from "./task-review.js"
import { TaskSubtasks } from "./task-subtasks.js"
import { TaskDescription, TaskTextEditor, TaskTitleEditor } from "./task-text-editor.js"
import { Tasks } from "./tasks.js"

type PageProps = {
  taskId: string
  userId: string
  organizationId: string
  onOpenSession: (id: string) => void
  onArchived: () => void
}

const reasonSchema = Schema.Struct({ value: Task.Reason })

export function TaskDetailPage(props: PageProps) {
  const context = RouterContext.useRouterContext()
  const detail = useQuery({ ...context.api.task.get.queryOptions({ idOrSlug: props.taskId }), refetchInterval: 5000 })
  const catalog = Tasks.useCatalog(props.organizationId)
  if (!detail.data)
    return detail.isError ? (
      <Page.Root title="Task">
        <Empty role="alert">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon glyph="AlertCircle" tone="danger" />
            </EmptyMedia>
            <EmptyTitle>Couldn’t load this task.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </Page.Root>
    ) : (
      <Page.RecordPending />
    )
  return <Detail key={detail.data.id} {...props} task={detail.data} catalog={catalog} refreshError={detail.isError} />
}

type DetailProps = PageProps & { task: TaskInfo; catalog: ReturnType<typeof Tasks.useCatalog>; refreshError: boolean }

function useHeaderActions() {
  const context = RouterContext.useRouterContext()
  return {
    update: useMutation(context.api.task.update.mutationOptions()),
    assign: useMutation(context.api.task.assign.mutationOptions()),
    start: useMutation(context.api.task.start.mutationOptions()),
    archive: useMutation(context.api.task.archive.mutationOptions()),
  }
}

function Detail(props: DetailProps) {
  const context = RouterContext.useRouterContext()
  const task = props.task
  const actions = Tasks.useTaskActions()
  const header = useHeaderActions()
  const review = useMutation(context.api.task.review.mutationOptions())
  const [requesting, setRequesting] = useState(false)
  const error = header.update.error ?? header.assign.error ?? header.start.error
  return (
    <Page.Record
      banner={
        <DetailHeader
          task={task}
          actions={header}
          onRequestReview={() => setRequesting(true)}
          onArchived={props.onArchived}
        />
      }
      aside={<Properties task={task} catalog={props.catalog} actions={actions} />}
    >
      <article aria-label="Task detail" className="flex min-w-0 flex-col gap-8">
        {props.refreshError ? (
          <Alert variant="destructive">
            <Icon glyph="AlertCircle" />
            <AlertDescription>Couldn’t refresh this task. Showing the last loaded version.</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <Icon glyph="AlertCircle" />
            <AlertDescription>{Tasks.describe(error)}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-4">
          <TaskTitleEditor
            value={task.title}
            {...(task.canUpdate && { onSave: (title: string) => actions.update(task, { title }) })}
          />
          <AttentionTurn
            task={task}
            owner={TaskView.attentionOwner(task, props.userId, props.catalog.person)}
            turn={TaskView.turn(task, {
              agent: props.catalog.agentName,
              owner: (id) => props.catalog.person(id)?.name,
              userId: props.userId,
            })}
          />
          <AttentionNotice task={task} onOpen={props.onOpenSession} />
          <SessionLink session={task.session} onOpen={props.onOpenSession} />
          <TaskDescription
            value={task.description}
            {...(task.canUpdate && {
              onSave: (description: string) => actions.update(task, { description: description || null }),
            })}
          />
        </div>
        {task.humanReview ? <TaskReview task={task} /> : null}
        {requesting ? (
          <TaskTextEditor
            label="Review reason"
            value=""
            schema={reasonSchema}
            onSave={(reason) => review.mutateAsync({ id: task.id, payload: { humanReview: true, reason } })}
            onCancel={() => setRequesting(false)}
          />
        ) : null}
        {task.parentId === null ? <TaskSubtasks task={task} catalog={props.catalog} userId={props.userId} /> : null}
        <TaskActivity task={task} catalog={props.catalog} onOpenSession={props.onOpenSession} />
      </article>
    </Page.Record>
  )
}

function Properties(props: {
  task: TaskInfo
  catalog: ReturnType<typeof Tasks.useCatalog>
  actions: ReturnType<typeof Tasks.useTaskActions>
}) {
  const task = props.task
  const controls = {
    task,
    presentation: "row" as const,
    disabled: !task.canUpdate,
    onChange: (patch: Tasks.Patch) => props.actions.update(task, patch),
    onAssign: (assignment: Tasks.Assignment) => props.actions.assign(task, assignment),
  }
  return (
    <aside aria-label="Task properties" className="flex flex-col gap-6">
      <Page.Section title="Properties">
        <div className="flex flex-col items-start gap-1">
          <StatusControl {...controls} />
          <PriorityControl {...controls} />
          <AgentControl
            {...controls}
            agentName={task.agentId ? (props.catalog.agentName(task.agentId) ?? "Archived agent") : undefined}
          />
          <OwnerControl {...controls} owner={task.ownerId ? props.catalog.person(task.ownerId) : undefined} />
          <DueDateControl {...controls} />
          {task.subtasks === null ? <ParentControl {...controls} /> : null}
        </div>
      </Page.Section>
      <Page.Section title="Labels">
        <LabelsControl {...controls} />
      </Page.Section>
      {task.links.length > 0 ? (
        <Page.Section title="Links">
          <div className="flex flex-wrap gap-2">
            {task.links.map((link) => (
              <TaskLinkBadge key={link.id} link={link} />
            ))}
          </div>
        </Page.Section>
      ) : null}
    </aside>
  )
}

function DetailHeader(props: {
  task: TaskInfo
  actions: ReturnType<typeof useHeaderActions>
  onRequestReview: () => void
  onArchived: () => void
}) {
  const task = props.task
  const actions = props.actions
  const [archiving, setArchiving] = useState(false)
  return (
    <>
      <div className="min-w-0 flex-1">
        <Breadcrumb aria-label="Breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/tasks" />}>Tasks</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            {task.parent ? (
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to="/tasks/$taskId" params={{ taskId: task.parent.id }} />}>
                  {task.parent.identifier}
                </BreadcrumbLink>
              </BreadcrumbItem>
            ) : null}
            {task.parent ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              <BreadcrumbPage>{task.identifier}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {task.canUpdate ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  disabled={!task.agentId || !TaskView.isActionable(task) || actions.start.isPending}
                />
              }
            >
              {actions.start.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {actions.start.isPending ? "Starting agent…" : "Start agent"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => actions.start.mutate({ id: task.id, mode: "continue" })}>
                  Continue session
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.start.mutate({ id: task.id, mode: "new" })}>
                  Start new session
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" aria-label="Task actions" />}>
              Actions
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => actions.update.mutate({ id: task.id, status: "done" })}>
                  Mark done
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.update.mutate({ id: task.id, status: "dismissed" })}>
                  Dismiss
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.assign.mutate({ id: task.id, agentId: null, start: "none" })}>
                  Take over
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!TaskView.isActionable(task)} onClick={props.onRequestReview}>
                  Request human review
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={() => setArchiving(true)}>
                  Archive task
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ConfirmationDialog
            open={archiving}
            onOpenChange={setArchiving}
            title="Archive task?"
            description={`“${task.title}” will be removed from Tasks.`}
            confirmLabel="Archive"
            tone="danger"
            onConfirm={() => actions.archive.mutateAsync({ id: task.id })}
            onConfirmed={props.onArchived}
          />
        </>
      ) : null}
    </>
  )
}

function SessionLink(props: { session: TaskInfo["session"]; onOpen: (id: string) => void }) {
  const session = props.session
  if (!session) return null
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => props.onOpen(session.id)}>
        Open agent session
      </Button>
    </div>
  )
}
