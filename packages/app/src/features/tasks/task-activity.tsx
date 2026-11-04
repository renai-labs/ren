import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { useState } from "react"
import type { TaskActivityInfo, TaskActor, TaskEventInfo } from "@ren/client"
import {
  IconArchive,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconChevronRight,
  IconCirclePlus,
  IconHandStop,
  IconGhostFilled,
  IconLink,
  IconMessage,
  IconPencil,
  IconPlayerStopFilled,
  IconSubtask,
  IconTag,
  IconArrowBackUp,
} from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@ren/ui/input-group"
import { toast } from "@ren/ui/sonner"
import { formatDateTime, formatRelative } from "@ren/ui/time"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Item, ItemHeader } from "@ren/ui/item"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@ren/ui/trace"
import { StatusGlyph, statusOf } from "../../components/task-meta.js"
import { Markdown } from "../../components/markdown.js"
import { errorMessage } from "../../lib/errors.js"
import { taskActivityOptions } from "../../lib/tasks.js"
import { RouterContext } from "../../lib/router-context.js"
import { useAgents } from "../../lib/use-agents.js"
import { useNow } from "../../lib/use-now.js"
import { useMembers } from "../../lib/use-members.js"
import { useSpaces } from "../../lib/use-spaces.js"

type Names = {
  readonly actor: (actor: TaskActor) => string
  readonly image: (actor: TaskActor) => string | undefined
  readonly agent: (agentId: string | null) => string | undefined
  readonly person: (userId: string | null) => string | undefined
  readonly space: (spaceId: string) => string
}

function useNames(): Names {
  const agents = useAgents()
  const members = useMembers()
  const spaces = useSpaces()
  const agent = (agentId: string | null) => agents.agent(agentId)?.name
  const person = (userId: string | null) => members.member(userId)?.name
  return {
    agent,
    person,
    space: spaces.spaceName,
    image: (actor) => (actor.agentId ? undefined : (members.member(actor.userId)?.image ?? undefined)),
    actor: (actor) => (actor.agentId ? (agent(actor.agentId) ?? "Agent") : (person(actor.userId) ?? "Ren")),
  }
}

const fields = { title: "title", description: "description", priority: "priority", dueAt: "due date" } as const

const assignment = (data: Extract<TaskEventInfo["data"], { _tag: "assigned" }>, names: Names) => {
  const moved = data.fromSpaceId === data.toSpaceId ? undefined : `moved it to ${names.space(data.toSpaceId)}`
  const assignee = names.agent(data.toAgentId) ?? names.person(data.toOwnerId)
  const changed = data.fromAgentId !== data.toAgentId || data.fromOwnerId !== data.toOwnerId
  const handoff = data.fromAgentId !== null && data.toAgentId !== null
  const assigned = assignee ? `${handoff ? "handed off to" : "assigned it to"} ${assignee}` : "removed the assignee"
  return [changed ? assigned : undefined, moved].filter(Boolean).join(" and ") || "changed the assignment"
}

type EventData = TaskEventInfo["data"]

const parentChange = (data: Extract<EventData, { _tag: "parent" }>) => {
  if (data.to === null) return "made this a task of its own"
  return data.from === null ? "made this a sub-task" : "moved this sub-task to another parent"
}

type Of<Tag extends EventData["_tag"]> = Extract<EventData, { _tag: Tag }>

const statusChange = (data: Of<"status">) =>
  `${data.automation ? "merged a pull request and " : ""}changed status from ${statusOf(data.from).label} to ${statusOf(data.to).label}`

const started = (data: Of<"started">, names: Names) =>
  `started ${names.agent(data.agentId) ?? "an agent"} in ${data.mode === "new" ? "a new" : "the last"} session`

const reviewed = (data: Of<"reviewed">) => (data.decision === "approved" ? "approved the review" : "requested changes")

const labels = (data: Of<"label">) => `changed labels to ${data.to.join(", ") || "none"}`

const links = (data: Of<"link">) => (data.added.length > 0 ? "added a link" : "removed a link")

function eventText(data: EventData, names: Names) {
  switch (data._tag) {
    case "status":
      return statusChange(data)
    case "started":
      return started(data, names)
    case "assigned":
      return assignment(data, names)
    case "reviewed":
      return reviewed(data)
    case "field":
      return `changed the ${fields[data.field]}`
    case "label":
      return labels(data)
    case "link":
      return links(data)
    case "parent":
      return parentChange(data)
    case "created":
      return "created the task"
    case "archived":
      return "archived the task"
    case "review_requested":
      return "requested a human review"
  }
}

const eventNote = (event: TaskEventInfo) => {
  if (event.data._tag === "review_requested") return event.data.reason
  if (event.data._tag === "reviewed") return event.data.comment
  if (event.data._tag === "assigned") return event.data.note
  return null
}

const when = (at: string) => (
  <time dateTime={at} title={formatDateTime(at)}>
    {formatRelative(at)}
  </time>
)

function ActorMark(props: { actor: TaskActor; names: Names }) {
  if (props.actor.agentId) return <IconGhostFilled />
  const image = props.names.image(props.actor)
  return (
    <Avatar size="sm" className="data-[size=sm]:size-4">
      {image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback className="text-2xs">{props.names.actor(props.actor).charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

const eventIcons = {
  created: IconCirclePlus,
  assigned: IconArrowRight,
  started: IconMessage,
  review_requested: IconHandStop,
  field: IconPencil,
  label: IconTag,
  link: IconLink,
  parent: IconSubtask,
  archived: IconArchive,
} as const

function EventMark(props: { event: TaskEventInfo }) {
  const data = props.event.data
  if (data._tag === "status") return <StatusGlyph status={data.to} />
  if (data._tag === "reviewed") return data.decision === "approved" ? <IconCheck /> : <IconArrowBackUp />
  const Icon = eventIcons[data._tag]
  return <Icon />
}

const sessionState = { busy: "Working", idle: "Finished" } as const

function StopSession(props: { sessionId: string; agent: string }) {
  const sessionId = Session.ID.make(props.sessionId)
  const stop = ChatReact.useAction(sessionId, (opened) => opened.stop(sessionId))
  const [stopping, setStopping] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Stop ${props.agent}’s session`}
      disabled={stopping}
      className="absolute top-2 right-2 rounded-full"
      onClick={() => {
        setStopping(true)
        void stop()
          .catch((error: unknown) => toast.error("Couldn’t stop the session", { description: errorMessage(error) }))
          .finally(() => setStopping(false))
      }}
    >
      {stopping ? <Spinner data-icon="inline-start" /> : <IconPlayerStopFilled data-icon="inline-start" />}
      Stop
    </Button>
  )
}

function SessionCard(props: {
  event: TaskEventInfo
  sessionId: string
  agentId: string
  names: Names
  onOpen: (sessionId: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const session = useQuery({
    ...api.session.get.queryOptions({ idOrSlug: props.sessionId }),
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "busy" ? 5000 : false),
  })
  const status = session.data?.status
  const agent = props.names.agent(props.agentId) ?? "Agent"
  return (
    <div className="relative ml-6 flex">
      <Button
        variant="outline"
        aria-label={`Open ${agent}’s session`}
        onClick={() => props.onOpen(props.sessionId)}
        className="h-auto flex-1 flex-col items-stretch gap-0 overflow-hidden rounded-xl bg-card p-0 text-left font-normal whitespace-normal hover:bg-muted/60 dark:bg-card dark:hover:bg-muted/60"
      >
        <span className="flex items-center gap-2 border-b px-3.5 py-2.5 text-sm">
          <IconMessage className="text-muted-foreground" />
          <span className="font-medium">{agent}</span>
          <span className="text-muted-foreground">
            started by {props.names.actor(props.event.actor)} · {when(props.event.createdAt)}
          </span>
        </span>
        <span className="flex items-center gap-2 px-3.5 py-2.5 text-sm">
          {status === "busy" ? (
            <Spinner className="size-3.5 text-chart-2" />
          ) : (
            <span aria-hidden className="mx-0.75 size-2 shrink-0 rounded-full bg-muted-foreground/60" />
          )}
          <span className={status === "busy" ? "text-foreground" : "text-muted-foreground"}>
            {status ? sessionState[status] : "Session"}
          </span>
          {session.data?.title ? (
            <span className="min-w-0 flex-1 truncate">{session.data.title}</span>
          ) : (
            <span className="flex-1" />
          )}
          <IconChevronRight className="shrink-0 text-muted-foreground" />
        </span>
      </Button>
      {status === "busy" ? <StopSession sessionId={props.sessionId} agent={agent} /> : null}
    </div>
  )
}

function Events(props: {
  events: ReadonlyArray<TaskEventInfo>
  names: Names
  onOpenSession: (sessionId: string) => void
}) {
  return (
    <Trace className="relative gap-4 pl-3.5 before:absolute before:inset-y-2.5 before:left-5.5 before:w-px before:bg-border">
      {props.events.map((event) => {
        const note = eventNote(event)
        const data = event.data
        if (data._tag === "started")
          return (
            <SessionCard
              key={event.id}
              event={event}
              sessionId={data.sessionId}
              agentId={data.agentId}
              names={props.names}
              onOpen={props.onOpenSession}
            />
          )
        return (
          <div key={event.id} className="flex flex-col gap-1.5">
            <TraceLine>
              <TraceIcon className="relative bg-background text-muted-foreground">
                <EventMark event={event} />
              </TraceIcon>
              <TraceTitle>
                {props.names.actor(event.actor)} {eventText(event.data, props.names)}{" "}
                <span className="text-muted-foreground/70">· {when(event.createdAt)}</span>
              </TraceTitle>
            </TraceLine>
            {note ? <p className="pl-6 text-sm whitespace-pre-wrap text-muted-foreground">{note}</p> : null}
          </div>
        )
      })}
    </Trace>
  )
}

function CommentCard(props: {
  comment: Extract<TaskActivityInfo, { type: "comment" }>["comment"]
  names: Names
  fresh: boolean
}) {
  return (
    <Item
      variant="outline"
      className={cn(
        "items-start gap-y-2 rounded-xl bg-card px-4 py-3.5",
        props.fresh &&
          "animate-in duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:slide-in-from-bottom-0",
      )}
    >
      <ItemHeader className="justify-start gap-2">
        <ActorMark actor={props.comment.author} names={props.names} />
        <span className="font-medium">{props.names.actor(props.comment.author)}</span>
        <span className="text-muted-foreground">{when(props.comment.createdAt)}</span>
      </ItemHeader>
      <Markdown className="w-full text-md/6 [&_h1]:text-base [&_h2]:text-base [&_h3]:text-md">
        {props.comment.body}
      </Markdown>
    </Item>
  )
}

type Block =
  | { readonly kind: "events"; readonly id: string; readonly events: ReadonlyArray<TaskEventInfo> }
  | { readonly kind: "comment"; readonly id: string; readonly item: Extract<TaskActivityInfo, { type: "comment" }> }

function blocksOf(items: ReadonlyArray<TaskActivityInfo>) {
  const blocks: Block[] = []
  for (const item of items) {
    const last = blocks.at(-1)
    if (item.type === "comment") blocks.push({ kind: "comment", id: item.id, item })
    else if (last?.kind === "events") blocks[blocks.length - 1] = { ...last, events: [...last.events, item.event] }
    else blocks.push({ kind: "events", id: item.id, events: [item.event] })
  }
  return blocks
}

const freshFor = 10_000

function CommentComposer(props: { taskId: string }) {
  const { api } = RouterContext.useRouterContext()
  const create = useMutation(api["task-comment"].create.mutationOptions())
  const [body, setBody] = useState("")
  const send = () => {
    const text = body.trim()
    if (!text || create.isPending) return
    create.mutate(
      { taskId: props.taskId, body: text },
      {
        onSuccess: () => setBody(""),
        onError: (error) => toast.error("Couldn’t post the comment", { description: errorMessage(error) }),
      },
    )
  }
  return (
    <InputGroup className="relative rounded-xl">
      <InputGroupTextarea
        aria-label="Comment"
        placeholder="Leave a comment…"
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          send()
        }}
        className="min-h-23 px-4 pt-3.5 pb-12 text-md md:text-md"
      />
      <InputGroupAddon align="block-end" className="absolute right-0 bottom-0 w-auto px-3 pb-3">
        <InputGroupButton
          variant={body.trim() ? "default" : "ghost"}
          size="icon-xs"
          className="rounded-full"
          aria-label="Comment"
          disabled={create.isPending || !body.trim()}
          onClick={send}
        >
          <IconArrowUp />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function TaskActivity(props: { taskId: string; onOpenSession: (sessionId: string) => void }) {
  const { client } = RouterContext.useRouterContext()
  const names = useNames()
  const now = useNow()
  const activity = useQuery(taskActivityOptions(client, props.taskId))
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-md font-semibold">Activity</h2>
      {activity.isPending ? (
        <Loading label="Loading task activity">
          <Trace>
            <TraceLine>
              <TraceIcon>
                <IconGhostFilled />
              </TraceIcon>
              <TraceTitle>Task activity</TraceTitle>
            </TraceLine>
          </Trace>
        </Loading>
      ) : null}
      <div className="flex flex-col gap-4">
        {blocksOf(activity.data ?? []).map((block) =>
          block.kind === "events" ? (
            <Events key={block.id} events={block.events} names={names} onOpenSession={props.onOpenSession} />
          ) : (
            <CommentCard
              key={block.id}
              comment={block.item.comment}
              names={names}
              fresh={now - Date.parse(block.item.comment.createdAt) < freshFor}
            />
          ),
        )}
        <div className="pt-4">
          <CommentComposer taskId={props.taskId} />
        </div>
      </div>
    </section>
  )
}
