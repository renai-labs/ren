import type { TaskInfo } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Breadcrumbs } from "@ren/ui/breadcrumbs"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { LoadingMessage } from "@ren/ui/loading-message"
import { Menu } from "@ren/ui/menu"
import { Notice } from "@ren/ui/notice"
import { PageShell } from "@ren/ui/page-shell"
import { StateMessage } from "@ren/ui/state-message"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { useQuery } from "@tanstack/react-query"
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
  PriorityControl,
  StatusControl,
} from "./task-controls.js"
import { TaskView } from "./task-view.js"
import { TaskReview } from "./task-review.js"
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
    return (
      <PageShell.Root title="Task">
        {detail.isError ? (
          <StateMessage
            state="failed"
            placement="section"
            title="Couldn’t load this task."
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <LoadingMessage placement="section" title="Loading task…" />
        )}
      </PageShell.Root>
    )
  return <Detail key={detail.data.id} {...props} task={detail.data} catalog={catalog} refreshError={detail.isError} />
}

type DetailProps = PageProps & { task: TaskInfo; catalog: ReturnType<typeof Tasks.useCatalog>; refreshError: boolean }

function useHeaderActions() {
  const context = RouterContext.useRouterContext()
  return {
    update: Tasks.useTaskMutation(context.api.task.update.mutationOptions()),
    assign: Tasks.useTaskMutation(context.api.task.assign.mutationOptions()),
    start: Tasks.useTaskMutation(context.api.task.start.mutationOptions()),
    archive: Tasks.useTaskMutation(context.api.task.archive.mutationOptions()),
  }
}

function Detail(props: DetailProps) {
  const context = RouterContext.useRouterContext()
  const task = props.task
  const actions = Tasks.useTaskActions()
  const header = useHeaderActions()
  const review = Tasks.useTaskMutation(context.api.task.review.mutationOptions())
  const [requesting, setRequesting] = useState(false)
  const error = header.update.error ?? header.assign.error ?? header.start.error
  return (
    <PageShell.Record
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
          <Notice tone="danger">Couldn’t refresh this task. Showing the last loaded version.</Notice>
        ) : null}
        {error ? <Notice tone="danger">{Tasks.describe(error)}</Notice> : null}
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
        <TaskActivity task={task} catalog={props.catalog} onOpenSession={props.onOpenSession} />
      </article>
    </PageShell.Record>
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
      <PageShell.Section title="Properties">
        <div className="flex flex-col items-start gap-1">
          <StatusControl {...controls} />
          <PriorityControl {...controls} />
          <AgentControl
            {...controls}
            agentName={task.agentId ? (props.catalog.agentName(task.agentId) ?? "Archived agent") : undefined}
          />
          <OwnerControl {...controls} owner={task.ownerId ? props.catalog.person(task.ownerId) : undefined} />
          <DueDateControl {...controls} />
        </div>
      </PageShell.Section>
      <PageShell.Section title="Labels">
        <LabelsControl {...controls} />
      </PageShell.Section>
      {task.links.length > 0 ? (
        <PageShell.Section title="Links">
          <div className="flex flex-wrap gap-2">
            {task.links.map((link) => (
              <TaskLinkBadge key={link.id} link={link} />
            ))}
          </div>
        </PageShell.Section>
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
        <Breadcrumbs.Root>
          <Breadcrumbs.Link render={<Link to="/tasks" />}>Tasks</Breadcrumbs.Link>
          <Breadcrumbs.Page>{task.identifier}</Breadcrumbs.Page>
        </Breadcrumbs.Root>
      </div>
      {task.canUpdate ? (
        <>
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button disabled={!task.agentId || !TaskView.isActionable(task) || actions.start.isPending}>
                  {actions.start.isPending ? "Starting agent…" : "Start agent"}
                </Button>
              }
            />
            <Menu.Popup alignment="end">
              <Menu.Item onSelect={() => actions.start.mutate({ id: task.id, mode: "continue" })}>
                Continue session
              </Menu.Item>
              <Menu.Item onSelect={() => actions.start.mutate({ id: task.id, mode: "new" })}>
                Start new session
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button appearance="plain" aria-label="Task actions">
                  Actions
                </Button>
              }
            />
            <Menu.Popup alignment="end">
              <Menu.Item onSelect={() => actions.update.mutate({ id: task.id, status: "done" })}>Mark done</Menu.Item>
              <Menu.Item onSelect={() => actions.update.mutate({ id: task.id, status: "dismissed" })}>
                Dismiss
              </Menu.Item>
              <Menu.Item onSelect={() => actions.assign.mutate({ id: task.id, agentId: null, start: "none" })}>
                Take over
              </Menu.Item>
              <Menu.Item disabled={!TaskView.isActionable(task)} onSelect={props.onRequestReview}>
                Request human review
              </Menu.Item>
              <Menu.Item tone="danger" onSelect={() => setArchiving(true)}>
                Archive task
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
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
      <Button appearance="plain" size="small" onClick={() => props.onOpen(session.id)}>
        Open agent session
      </Button>
    </div>
  )
}
