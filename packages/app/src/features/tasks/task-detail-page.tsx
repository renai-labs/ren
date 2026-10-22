import type { TaskInfo } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Breadcrumbs } from "@ren/ui/breadcrumbs"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Notice } from "@ren/ui/notice"
import { PageShell } from "@ren/ui/page-shell"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { TaskTurn } from "@ren/ui/task-turn"
import { Text } from "@ren/ui/text"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { TaskActivity } from "./task-activity.js"
import {
  AgentControl,
  DueDateControl,
  LabelsControl,
  OwnerControl,
  PriorityControl,
  StatusControl,
} from "./task-controls.js"
import { TaskDetail } from "./task-detail.js"
import { TaskView } from "./task-view.js"
import { TaskReview } from "./task-review.js"
import { TaskDescription, TaskTextEditor } from "./task-text-editor.js"
import { Tasks } from "./tasks.js"

type PageProps = {
  taskId: string
  userId: string
  organizationId: string
  onOpenSession: (id: string) => void
  onArchived: () => void
  // ast-grep-ignore: no-render-props -- the task hands its current session ID to the route, which composes the session feature
  renderSessionAttention: (id: string, turn: ReactNode) => ReactNode
}

const titleSchema = Schema.Struct({ value: Task.Title })
const reasonSchema = Schema.Struct({ value: Task.Reason })

export function TaskDetailPage(props: PageProps) {
  const context = RouterContext.useRouterContext()
  const detail = useQuery({ ...context.api.task.get.queryOptions({ idOrSlug: props.taskId }), refetchInterval: 5000 })
  const catalog = Tasks.useCatalog(props.organizationId)
  if (!detail.data)
    return (
      <PageShell.Root title="Task">
        <Notice tone={detail.isError ? "danger" : "neutral"}>
          {detail.isError ? "Couldn’t load this task." : "Loading task…"}
        </Notice>
      </PageShell.Root>
    )
  return <Detail key={detail.data.id} {...props} task={detail.data} catalog={catalog} refreshError={detail.isError} />
}

type DetailProps = PageProps & { task: TaskInfo; catalog: ReturnType<typeof Tasks.useCatalog>; refreshError: boolean }

function Detail(props: DetailProps) {
  const task = props.task
  const actions = TaskDetail.useActions()
  const [requesting, setRequesting] = useState(false)
  const turn = (
    <TaskTurn
      {...TaskView.turn(task, {
        agent: props.catalog.agentName,
        owner: (id) => props.catalog.person(id)?.name,
        userId: props.userId,
      })}
    />
  )
  const error = actions.update.error ?? actions.assign.error ?? actions.start.error ?? actions.archive.error
  return (
    <PageShell.Record
      banner={
        <DetailHeader
          task={task}
          actions={actions}
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
          <TaskTitle task={task} actions={actions} />
          {task.session && TaskDetail.isActionable(task) ? props.renderSessionAttention(task.session.id, turn) : turn}
          <SessionLink session={task.session} onOpen={props.onOpenSession} />
          <TaskDescription
            value={task.description}
            {...(task.canUpdate && {
              onSave: (description: string) =>
                actions.update.mutateAsync({ id: task.id, description: description || null }),
            })}
          />
        </div>
        {task.humanReview ? <TaskReview task={task} /> : null}
        {requesting ? (
          <TaskTextEditor
            label="Review reason"
            value=""
            schema={reasonSchema}
            onSave={(reason) => actions.review.mutateAsync({ id: task.id, payload: { humanReview: true, reason } })}
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
  actions: ReturnType<typeof TaskDetail.useActions>
}) {
  const task = props.task
  const controls = {
    task,
    presentation: "row" as const,
    disabled: !task.canUpdate,
    onChange: (patch: Tasks.Patch) =>
      props.actions.update.mutateAsync({
        id: task.id,
        title: patch.title,
        description: patch.description,
        status: patch.status,
        priority: patch.priority,
        dueAt: patch.dueAt,
        ...(patch.labels && { labels: patch.labels.map((label) => label.name) }),
      }),
    onAssign: (assignment: Tasks.Assignment) =>
      props.actions.assign.mutateAsync({ id: task.id, ...assignment, start: "none" }),
  }
  return (
    <aside aria-label="Task properties" className="flex flex-col gap-6">
      <PageShell.Section title="Properties">
        <div className="flex flex-col items-start gap-1">
          <StatusControl {...controls} />
          <PriorityControl {...controls} />
          <AgentControl {...controls} agentName={task.agentId ? props.catalog.agentName(task.agentId) : undefined} />
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
  actions: ReturnType<typeof TaskDetail.useActions>
  onRequestReview: () => void
  onArchived: () => void
}) {
  const task = props.task
  const actions = props.actions
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
                <Button disabled={!task.agentId || !TaskDetail.isActionable(task) || actions.start.isPending}>
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
              <Menu.Item disabled={!TaskDetail.isActionable(task)} onSelect={props.onRequestReview}>
                Request human review
              </Menu.Item>
              <Menu.Item
                disabled={actions.archive.isPending}
                onSelect={() => actions.archive.mutate({ id: task.id }, { onSuccess: props.onArchived })}
              >
                Archive task
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
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

function TaskTitle(props: { task: TaskInfo; actions: ReturnType<typeof TaskDetail.useActions> }) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return (
      <TaskTextEditor
        label="Title"
        value={props.task.title}
        schema={titleSchema}
        onSave={(title) => props.actions.update.mutateAsync({ id: props.task.id, title })}
        onCancel={() => setEditing(false)}
      />
    )
  return (
    <div className="flex flex-col items-start gap-2">
      <Text purpose="title" element="h1">
        {props.task.canUpdate ? (
          <Button
            appearance="text"
            wrapping="normal"
            aria-label={`Edit title: ${props.task.title}`}
            onClick={() => setEditing(true)}
          >
            <Text purpose="title" element="span">
              {props.task.title}
            </Text>
            <Icon glyph="Pencil" tone="secondary" />
          </Button>
        ) : (
          props.task.title
        )}
      </Text>
    </div>
  )
}
