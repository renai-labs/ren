import type { TaskActor, TaskCommentInfo, TaskEventData, TaskInfo } from "@ren/client"
import { Channel } from "@ren/schema/channel"
import { TaskComment } from "@ren/schema/task-comment"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Document } from "@ren/ui/document"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Schema } from "effect"
import { RouterContext } from "../../lib/router-context.js"
import { Pages } from "../../lib/pages.js"
import { TaskHistory } from "./task-history.js"
import type { ReactNode } from "react"
import { TaskTextEditor } from "./task-text-editor.js"
import { TaskView } from "./task-view.js"
import { Tasks } from "./tasks.js"
import { TaskSessionCard } from "./task-session-card.js"

const commentSchema = Schema.Struct({ value: TaskComment.Body })

export function TaskActivity(props: {
  task: TaskInfo
  catalog: ReturnType<typeof Tasks.useCatalog>
  onOpenSession: (id: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const history = useQuery({
    ...Pages.all((page) =>
      context.api["task-activity"].list.queryOptions({ taskId: props.task.id, page, pageSize: 100 }),
    ),
    refetchInterval: 5000,
  })
  const actorName = (actor: TaskActor) => {
    if (actor.agentId) return props.catalog.agentName(actor.agentId) ?? "Archived agent"
    return actor.userId ? (props.catalog.person(actor.userId)?.name ?? "Former member") : "Ren"
  }
  return (
    <PageShell.Section title="Activity">
      {history.isPending ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Loading activity…</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {history.isError ? (
        <Alert variant="destructive" className="has-data-[slot=alert-action]:pr-32">
          <Icon glyph="AlertCircle" />
          <AlertDescription>Couldn’t load activity. {Tasks.describe(history.error)}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="sm" onClick={() => void history.refetch()}>
              Retry activity
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-6">
        {TaskHistory.groups(history.data?.items ?? []).map((group) => (
          <ActivityGroup key={group.id} quiet={group.quiet}>
            {group.items.map((item) =>
              item.type === "comment" ? (
                <Comment key={item.id} comment={item.comment} author={actorName(item.comment.author)} />
              ) : (
                <div key={item.id} className="flex flex-col gap-2">
                  <Text purpose="caption" tone="secondary">
                    <Text purpose="label" element="span">
                      {item.event.data._tag === "status" && item.event.data.automation
                        ? Channel.titles[item.event.data.automation.provider]
                        : actorName(item.event.actor)}
                    </Text>
                    {" · "}
                    <Time value={item.event.createdAt} format="relative" />
                  </Text>
                  {item.event.data._tag === "created" && item.event.actor.sessionId ? (
                    <TaskSessionCard
                      sessionId={item.event.actor.sessionId}
                      agentName={item.event.actor.agentId ? props.catalog.agentName(item.event.actor.agentId) : "Ren"}
                      mode="created"
                      onOpen={props.onOpenSession}
                    />
                  ) : null}
                  <Event
                    data={item.event.data}
                    agentName={props.catalog.agentName}
                    personName={(id) => props.catalog.person(id)?.name}
                    onOpenSession={props.onOpenSession}
                  />
                </div>
              ),
            )}
          </ActivityGroup>
        ))}
      </div>
      {props.task.canUpdate ? <CommentComposer taskId={props.task.id} /> : null}
    </PageShell.Section>
  )
}

function ActivityGroup(props: { quiet: boolean; children: ReadonlyArray<ReactNode> }) {
  if (!props.quiet || props.children.length <= 3) return props.children
  return (
    <div className="flex flex-col gap-4">
      <Details summary={`Show ${props.children.length - 3} earlier events`}>{props.children.slice(0, -3)}</Details>
      {props.children.slice(-3)}
    </div>
  )
}

function Details(props: { summary: string; children: ReactNode }) {
  return (
    <Collapsible className="flex min-w-0 flex-col">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="group/details -ml-2.5 self-start text-muted-foreground" />}
      >
        <span className="flex transition-standard group-data-panel-open/details:rotate-90 motion-reduce:transition-none">
          <Icon glyph="ChevronRight" size="extra-small" />
        </span>
        {props.summary}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-standard data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="flex min-w-0 flex-col gap-3 pt-3">{props.children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function CommentComposer(props: { taskId: string }) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api["task-comment"].create.mutationOptions())
  const [composing, setComposing] = useState(false)
  if (composing)
    return (
      <TaskTextEditor
        label="Comment"
        value=""
        schema={commentSchema}
        onSave={(body) => create.mutateAsync({ taskId: props.taskId, body })}
        onCancel={() => setComposing(false)}
      />
    )
  return (
    <div>
      <Button variant="outline" onClick={() => setComposing(true)}>
        Add comment
      </Button>
    </div>
  )
}

function Event(props: {
  data: TaskEventData
  agentName: (id: string) => string | undefined
  personName: (id: string) => string | undefined
  onOpenSession: (id: string) => void
}) {
  const data = props.data
  switch (data._tag) {
    case "created":
      return <Text purpose="body">Created the task.</Text>
    case "archived":
      return <Text purpose="body">Archived the task.</Text>
    case "status":
      return <StatusEvent data={data} />
    case "started":
      return (
        <TaskSessionCard
          sessionId={data.sessionId}
          agentName={props.agentName(data.agentId)}
          mode={data.mode}
          onOpen={props.onOpenSession}
        />
      )
    case "assigned":
      return <AssignmentEvent data={data} agentName={props.agentName} personName={props.personName} />
    case "review_requested":
      return (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Alert renders a div; a warning is a status, not an alert
        <Alert role="status">
          <Icon glyph="AlertTriangle" tone="warning" />
          <AlertTitle>Requested human review</AlertTitle>
          <AlertDescription>
            <Document.Markdown content={data.reason} />
          </AlertDescription>
        </Alert>
      )
    case "reviewed":
      return <ReviewEvent data={data} />
    case "field":
      return <FieldEvent data={data} />
    case "label":
      return <LabelEvent data={data} />
    case "parent":
      return <Text purpose="body">{parentChange(data)}</Text>
    case "link":
      return (
        <div className="flex flex-col gap-2">
          {data.added.map((url) => (
            <Text key={url} purpose="body">
              Added link: {url}
            </Text>
          ))}
          {data.removed.map((url) => (
            <Text key={url} purpose="body">
              Removed link: {url}
            </Text>
          ))}
        </div>
      )
  }
}

const parentChange = (data: Extract<TaskEventData, { _tag: "parent" }>) => {
  if (data.to === null) return "Made this a task of its own."
  return data.from === null ? "Made this a sub-task." : "Moved this sub-task to another parent."
}

function StatusEvent(props: { data: Extract<TaskEventData, { _tag: "status" }> }) {
  return (
    <Text purpose="body">
      {props.data.automation ? "Pull request merged. " : null}
      Changed status from {TaskView.statusLabel[props.data.from]} to {TaskView.statusLabel[props.data.to]}.
    </Text>
  )
}

function ReviewEvent(props: { data: Extract<TaskEventData, { _tag: "reviewed" }> }) {
  return (
    <div className="flex flex-col gap-2">
      <Text purpose="body">{props.data.decision === "approved" ? "Approved the review." : "Requested changes."}</Text>
      {props.data.comment ? <Document.Markdown content={props.data.comment} /> : null}
    </div>
  )
}

function LabelEvent(props: { data: Extract<TaskEventData, { _tag: "label" }> }) {
  return (
    <Text purpose="body">
      Changed labels from {props.data.from.join(", ") || "none"} to {props.data.to.join(", ") || "none"}.
    </Text>
  )
}

function AssignmentEvent(props: {
  data: Extract<TaskEventData, { _tag: "assigned" }>
  agentName: (id: string) => string | undefined
  personName: (id: string) => string | undefined
}) {
  const data = props.data
  return (
    <div className="flex flex-col gap-2">
      {data.fromAgentId !== data.toAgentId ? (
        <Text purpose="body">
          Assigned agent: {data.toAgentId ? (props.agentName(data.toAgentId) ?? "Archived agent") : "No agent"}.
        </Text>
      ) : null}
      {data.fromOwnerId !== data.toOwnerId ? (
        <Text purpose="body">
          Assigned owner: {data.toOwnerId ? (props.personName(data.toOwnerId) ?? "Former member") : "No owner"}.
        </Text>
      ) : null}
      {data.fromSpaceId !== data.toSpaceId ? <Text purpose="body">Moved the task to another space.</Text> : null}
      {data.note ? <Document.Markdown content={data.note} /> : null}
    </div>
  )
}

function FieldEvent(props: { data: Extract<TaskEventData, { _tag: "field" }> }) {
  return (
    <Details summary={`Changed ${props.data.field === "dueAt" ? "due date" : props.data.field}.`}>
      <Text purpose="caption" tone="secondary">
        Before
      </Text>
      <Document.Markdown content={props.data.from ?? "Empty"} />
      <Text purpose="caption" tone="secondary">
        After
      </Text>
      <Document.Markdown content={props.data.to ?? "Empty"} />
    </Details>
  )
}

function Comment(props: { comment: TaskCommentInfo; author: string }) {
  const context = RouterContext.useRouterContext()
  const edit = useMutation(context.api["task-comment"].update.mutationOptions())
  const archive = useMutation(context.api["task-comment"].archive.mutationOptions())
  const [editing, setEditing] = useState(false)
  return (
    <article aria-label={`Comment by ${props.author}`} className="flex flex-col gap-3">
      <Text purpose="caption" tone="secondary">
        <Text purpose="label" element="span">
          {props.author}
        </Text>
        {" · "}
        <Time value={props.comment.createdAt} format="relative" />
        {props.comment.editedAt ? " · Edited" : null}
      </Text>
      {editing ? (
        <TaskTextEditor
          label="Comment"
          value={props.comment.body}
          schema={commentSchema}
          onSave={(body) => edit.mutateAsync({ id: props.comment.id, body })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Document.Markdown content={props.comment.body} />
      )}
      {props.comment.canUpdate && !editing ? (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit comment
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: props.comment.id })}
          >
            Delete comment
          </Button>
        </div>
      ) : null}
      {archive.error ? (
        <Alert variant="destructive">
          <Icon glyph="AlertCircle" />
          <AlertDescription>{Tasks.describe(archive.error)}</AlertDescription>
        </Alert>
      ) : null}
    </article>
  )
}
