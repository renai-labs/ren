import type { TaskActor, TaskCommentInfo, TaskEventData, TaskInfo } from "@ren/client"
import { TaskComment } from "@ren/schema/task-comment"
import { Button } from "@ren/ui/button"
import { Document } from "@ren/ui/document"
import { Notice } from "@ren/ui/notice"
import { PageShell } from "@ren/ui/page-shell"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Schema } from "effect"
import { RouterContext } from "../../lib/router-context.js"
import { TaskDetail } from "./task-detail.js"
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
  const options = context.api["task-activity"].list.queryOptions({ taskId: props.task.id, page: 1, pageSize: 50 })
  const history = useInfiniteQuery({
    // ast-grep-ignore: no-query-key-literal -- infinite data needs a distinct cache shape; the generated prefix keeps activity invalidation shared
    queryKey: [...options.queryKey, "timeline"],
    initialPageParam: 1,
    queryFn: (input) =>
      context.queryClient.query({
        ...context.api["task-activity"].list.queryOptions({
          taskId: props.task.id,
          page: input.pageParam,
          pageSize: 50,
        }),
        staleTime: 0,
      }),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    refetchInterval: 5000,
  })
  const actorName = (actor: TaskActor) => {
    if (actor.agentId) return props.catalog.agentName(actor.agentId) ?? "Archived agent"
    return actor.userId ? (props.catalog.person(actor.userId)?.name ?? "Former member") : "Ren"
  }
  return (
    <PageShell.Section title="Activity">
      {history.isPending ? (
        <output>
          <Text purpose="body" tone="secondary">
            Loading activity…
          </Text>
        </output>
      ) : null}
      {history.isError ? (
        <Notice
          tone="danger"
          action={
            <Button appearance="plain" onClick={() => void history.refetch()}>
              Retry activity
            </Button>
          }
        >
          Couldn’t load activity. {Tasks.describe(history.error)}
        </Notice>
      ) : null}
      <div className="flex flex-col gap-6">
        {history.data?.pages
          .flatMap((page) => page.items)
          .map((item) =>
            item.type === "comment" ? (
              <Comment key={item.id} comment={item.comment} author={actorName(item.comment.author)} />
            ) : (
              <div key={item.id} className="flex flex-col gap-2">
                <Text purpose="caption" tone="secondary">
                  <Text purpose="label" element="span">
                    {actorName(item.event.actor)}
                  </Text>
                  {" · "}
                  <Time value={item.event.createdAt} format="relative" />
                </Text>
                <Event
                  data={item.event.data}
                  agentName={props.catalog.agentName}
                  personName={(id) => props.catalog.person(id)?.name}
                  onOpenSession={props.onOpenSession}
                />
              </div>
            ),
          )}
      </div>
      {history.hasNextPage ? (
        <div>
          <Button
            appearance="outline"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage ? "Loading activity…" : "Load more activity"}
          </Button>
        </div>
      ) : null}
      {props.task.canUpdate ? <CommentComposer taskId={props.task.id} /> : null}
    </PageShell.Section>
  )
}

function CommentComposer(props: { taskId: string }) {
  const actions = TaskDetail.useActions()
  const [composing, setComposing] = useState(false)
  if (composing)
    return (
      <TaskTextEditor
        label="Comment"
        value=""
        schema={commentSchema}
        onSave={(body) => actions.comment.mutateAsync({ taskId: props.taskId, body })}
        onCancel={() => setComposing(false)}
      />
    )
  return (
    <div>
      <Button appearance="outline" onClick={() => setComposing(true)}>
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
      return (
        <Text purpose="body">
          Changed status from {TaskView.statusLabel[data.from]} to {TaskView.statusLabel[data.to]}.
        </Text>
      )
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
        <Notice tone="warning" title="Requested human review">
          <Document.Markdown content={data.reason} />
        </Notice>
      )
    case "reviewed":
      return <ReviewEvent data={data} />
    case "field":
      return <FieldEvent data={data} />
    case "label":
      return <LabelEvent data={data} />
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
    <details>
      <summary>
        <Text purpose="body" element="span">
          Changed {props.data.field === "dueAt" ? "due date" : props.data.field}.
        </Text>
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        <Text purpose="caption" tone="secondary">
          Before
        </Text>
        <Document.Markdown content={props.data.from ?? "Empty"} />
        <Text purpose="caption" tone="secondary">
          After
        </Text>
        <Document.Markdown content={props.data.to ?? "Empty"} />
      </div>
    </details>
  )
}

function Comment(props: { comment: TaskCommentInfo; author: string }) {
  const actions = TaskDetail.useActions()
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
          onSave={(body) => actions.editComment.mutateAsync({ id: props.comment.id, body })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Document.Markdown content={props.comment.body} />
      )}
      {props.comment.canUpdate && !editing ? (
        <div className="flex gap-2">
          <Button appearance="plain" size="small" onClick={() => setEditing(true)}>
            Edit comment
          </Button>
          <Button
            appearance="plain"
            size="small"
            disabled={actions.archiveComment.isPending}
            onClick={() => actions.archiveComment.mutate({ id: props.comment.id })}
          >
            Delete comment
          </Button>
        </div>
      ) : null}
      {actions.archiveComment.error ? (
        <Notice tone="danger">{Tasks.describe(actions.archiveComment.error)}</Notice>
      ) : null}
    </article>
  )
}
