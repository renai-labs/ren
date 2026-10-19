import { ChatState, Family, SessionTasks, type TimelineDetail, TimelineSearch, ToolState, Working } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session-info"
import type { SessionMessage } from "@ren/schema/session-message"
import { Button } from "@ren/ui/button"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { FindBar } from "@ren/ui/find-bar"
import { Notice } from "@ren/ui/notice"
import { StateMessage } from "@ren/ui/state-message"
import { TaskProgress, type TaskStatus } from "@ren/ui/task-progress"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useQuery } from "@tanstack/react-query"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useDeferredValue, useRef, useState } from "react"
import type { RefObject } from "react"
import { Auth } from "../../lib/auth.js"
import { Chat } from "../../lib/chat.js"
import { RouterContext } from "../../lib/router-context.js"
import { SessionCache } from "../../lib/session-cache.js"
import { Attention } from "../../platform/attention.js"
import { Keyboard } from "../../platform/keyboard.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"
import { SessionChild } from "./session-child.js"
import { SessionComposer } from "./session-composer.js"
import { SessionDrafts } from "./session-drafts.js"
import { SessionHeader } from "./session-header.js"
import { SessionKeys } from "./session-keys.js"
import { SessionRequests } from "./session-requests.js"
import { SessionTitle } from "./session-title.js"
import { transcriptRows } from "./transcript-rows.js"
import { Timeline } from "./timeline.js"

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const failed = (title: string) => (error: unknown) =>
  Toast.manager.add({ type: "error", title, description: describe(error) })

function useShortcuts(input: {
  sessionID: Session.ID
  child: Session.ID | undefined
  state: ChatState.State
  scroller: RefObject<ConversationShell.TimelineHandle | null>
  onBackground: () => void
  onFind: () => void
  onChild: (sessionID: Session.ID | undefined) => void
}) {
  Keyboard.useKeyDown((event) => {
    if (event.defaultPrevented) return
    const intent = SessionKeys.intent(event, {
      apple: Viewport.apple,
      child: input.child !== undefined,
      blocking: Family.background(input.state, input.sessionID).blocking.length > 0,
    })
    if (!intent || (intent === "parent" && Keyboard.isTyping(event))) return
    event.preventDefault()
    const run: Readonly<Record<SessionKeys.Intent, () => void>> = {
      previous: () => input.scroller.current?.step(-1),
      next: () => input.scroller.current?.step(1),
      background: input.onBackground,
      find: input.onFind,
      parent: () => {
        const parent = input.child ? input.state.info[input.child]?.parentID : undefined
        input.onChild(parent && parent !== input.sessionID ? Session.ID.make(parent) : undefined)
      },
    }
    run[intent]()
  })
}

const taskStatus: Readonly<Record<SessionTasks.Status, TaskStatus>> = {
  pending: "pending",
  in_progress: "in-progress",
  completed: "completed",
  cancelled: "cancelled",
}

function Tasks(props: { messages: ReadonlyArray<SessionMessage.Info>; running: boolean }) {
  const tasks = SessionTasks.latest(props.messages)
  if (tasks.length === 0 || !(props.running || SessionTasks.unfinished(tasks))) return null
  return (
    <TaskProgress
      tasks={tasks.map((task) => ({ id: task.id, content: task.content, status: taskStatus[task.status] }))}
    />
  )
}

function SessionInteraction(props: {
  sessionID: Session.ID
  state: ChatState.State
  reconnecting: boolean
  running: boolean
  onRedo: () => void
  onOpen: (sessionID: Session.ID) => void
  onAnswered: () => void
}) {
  return (
    <>
      <Tasks messages={ChatState.messages(props.state, props.sessionID)} running={props.running} />
      {props.reconnecting ? (
        <output>
          <Text purpose="caption" tone="secondary">
            Reconnecting
          </Text>
        </output>
      ) : null}
      {ChatState.revertMessageID(props.state, props.sessionID) ? (
        <Notice
          tone="neutral"
          placement="banner"
          layout="inline"
          action={
            <Button appearance="plain" size="small" onClick={props.onRedo}>
              Restore messages
            </Button>
          }
        >
          Later messages are undone. Sending a message discards them.
        </Notice>
      ) : null}
      <SessionRequests
        root={props.sessionID}
        sessionID={props.sessionID}
        state={props.state}
        onOpen={props.onOpen}
        onAnswered={props.onAnswered}
      />
    </>
  )
}

const read = (session: ReturnType<typeof ChatReact.useSession>) => {
  const timeline = AsyncResult.isSuccess(session.timeline) ? session.timeline.value : undefined
  return {
    state: AsyncResult.getOrElse(session.state, () => ChatState.empty),
    timeline,
    rows: timeline?.rows ?? [],
    reconnecting: AsyncResult.isSuccess(session.status) && session.status.value === "reconnecting",
  }
}

const blocked = (state: ChatState.State, sessionID: Session.ID, approving: boolean) =>
  Boolean((approving ? undefined : Family.permission(state, sessionID)) ?? Family.form(state, sessionID))

interface Find {
  readonly value: string
  readonly active: number
}

const findTarget = (rows: ReturnType<typeof read>["rows"], match: TimelineSearch.Match | undefined) => {
  if (!match) return
  if (match.role === "user") return Timeline.rowFor(rows, match.messageID)
  return Timeline.rowForPart(rows, (reference) => reference.partID === match.partID)
}

const partTarget = (
  rows: ReturnType<typeof read>["rows"],
  messages: ReadonlyArray<SessionMessage.Info>,
  part: string | undefined,
) => {
  if (!part) return
  const shells = new Set(
    messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((content) =>
            content.type === "tool" &&
            content.state.status !== "streaming" &&
            ToolState.metadata(content).shellID === part
              ? [content.id]
              : [],
          )
        : [],
    ),
  )
  return Timeline.rowForPart(rows, (reference) => reference.partID === part || shells.has(reference.partID))
}

const revealTarget = (rows: {
  readonly search: string | undefined
  readonly part: string | undefined
  readonly message: string | undefined
}) => ({
  target: rows.search ?? rows.part ?? rows.message,
  hold: rows.search === undefined && rows.part !== undefined,
})

function useFind(messages: ReadonlyArray<SessionMessage.Info>, rows: ReturnType<typeof read>["rows"]) {
  const [find, setFind] = useState<Find>()
  const query = useDeferredValue(find?.value ?? "")
  const matches = TimelineSearch.matches(messages, query)
  const active = TimelineSearch.step(find?.active ?? 0, matches.length, 0)
  const match = find ? matches[active] : undefined
  const row = findTarget(rows, match)
  return {
    find,
    row,
    open: () => setFind((previous) => previous ?? { value: "", active: 0 }),
    bar: find ? (
      <FindBar
        value={find.value}
        onValueChange={(value) => setFind({ value, active: 0 })}
        count={matches.length}
        active={active}
        match={row && match ? { row, occurrence: match.occurrence } : undefined}
        onStep={(delta) =>
          setFind((previous) =>
            previous ? { ...previous, active: TimelineSearch.step(previous.active, matches.length, delta) } : previous,
          )
        }
        onClose={() => setFind(undefined)}
      />
    ) : null,
  }
}

function useInputActions(sessionID: Session.ID) {
  const [updating, setUpdating] = useState<ReadonlySet<string>>(() => new Set())
  const queueInput = ChatReact.useAction(sessionID, (opened, inboxID: SessionMessage.ID) => opened.queueInput(inboxID))
  const cancelInput = ChatReact.useAction(sessionID, (opened, inboxID: SessionMessage.ID) =>
    opened.cancelInput(inboxID),
  )
  const act = (action: "queue" | "cancel", message: SessionMessage.User) => {
    if (updating.has(message.id)) return
    setUpdating((previous) => new Set([...previous, message.id]))
    const request = action === "queue" ? queueInput(message.id) : cancelInput(message.id)
    void request
      .catch(failed(action === "queue" ? "Could not move the message to the queue" : "Could not delete the message"))
      .finally(() => setUpdating((previous) => new Set([...previous].filter((id) => id !== message.id))))
  }
  return { updating, act }
}

function useOpenSession(input: {
  sessionID: Session.ID
  state: ChatState.State
  onChild: (sessionID: Session.ID) => void
  onNavigate: (sessionID: Session.ID) => void
}) {
  const context = RouterContext.useRouterContext()
  return (id: string) => {
    if (id === input.sessionID) return
    if (Family.tree(input.state, input.sessionID).includes(id)) return input.onChild(Session.ID.make(id))
    void context.queryClient.query(context.api.session.get.queryOptions({ idOrSlug: id })).then(
      (found) => input.onNavigate(Session.ID.make(found.id)),
      () => Toast.manager.add({ type: "error", title: "Could not find that chat" }),
    )
  }
}

function useRevert(sessionID: Session.ID, restore: (message: Option.Option<SessionMessage.User>) => void) {
  const [reverting, setReverting] = useState(false)
  const revert = ChatReact.useAction(sessionID, (opened, messageID: SessionMessage.ID) => opened.revert(messageID))
  return {
    reverting,
    onRevert: (message: SessionMessage.User) => {
      if (reverting) return
      setReverting(true)
      void revert(message.id)
        .then(restore, failed("Could not revert to this message"))
        .finally(() => setReverting(false))
    },
  }
}

function usePeople(organizationId: string | undefined, viewer: string, messages: ReadonlyArray<SessionMessage.Info>) {
  const context = RouterContext.useRouterContext()
  const shared = messages.some(
    (message) => message.type === "user" && message.sender !== undefined && message.sender.userId !== viewer,
  )
  const members = useQuery({
    ...Auth.organizationOptions(context.auth, organizationId ?? ""),
    enabled: shared && organizationId !== undefined,
    select: (organization) => organization.members,
  })
  return new Map(
    (members.data ?? []).map((member) => [
      member.userId,
      { name: member.user.name || member.user.email || "Member", image: member.user.image ?? undefined },
    ]),
  )
}

const liveOf = (info: SessionInfo.Info | undefined, running: boolean): SessionCache.Live => {
  if (!info) return { title: undefined, status: undefined }
  return { title: SessionTitle.display(info.title, "") || undefined, status: running ? "busy" : "idle" }
}

const modelNamesOf = (models: ReturnType<typeof ChatReact.useModels>) =>
  new Map(AsyncResult.getOrElse(models, () => []).map((model) => [model.id, model.name]))

export function SessionChat(props: {
  sessionID: Session.ID
  viewer: string
  organizationId: string | undefined
  detail: TimelineDetail.Detail | undefined
  message: SessionMessage.ID | undefined
  part: string | undefined
  child: Session.ID | undefined
  onFollow: () => void
  onChild: (sessionID: Session.ID | undefined) => void
  onArchived: () => void
  onNavigate: (sessionID: Session.ID) => void
}) {
  const platform = Platform.usePlatform()
  const context = RouterContext.useRouterContext()
  const stored = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.sessionID }),
    select: (session) => session.title,
  })
  const session = ChatReact.useSession(props.sessionID)
  const view = read(session)
  const state = view.state
  const timeline = view.timeline
  const rows = view.rows
  const messages = ChatState.messages(state, props.sessionID)
  const info = state.info[props.sessionID]
  const running = ChatState.activity(state, props.sessionID) === "running"
  const title = SessionTitle.display(info?.title ?? stored.data, SessionTitle.untitled)
  const asking = ChatState.permissionSessions(state).length + ChatState.formSessions(state).length
  const scroller = useRef<ConversationShell.TimelineHandle>(null)
  const [restored, setRestored] = useState(0)
  const finder = useFind(messages, rows)
  const reveal = revealTarget({
    search: finder.row,
    part: partTarget(rows, messages, props.part),
    message: Timeline.rowFor(rows, props.message),
  })
  const modelNames = modelNamesOf(ChatReact.useModels(props.sessionID))
  const inputs = useInputActions(props.sessionID)
  const openSession = useOpenSession({
    sessionID: props.sessionID,
    state,
    onChild: props.onChild,
    onNavigate: props.onNavigate,
  })
  Chat.useReveal(props.sessionID, props.sessionID, props.message)
  const loadMore = ChatReact.useAction(props.sessionID, (opened) => opened.loadMore(props.sessionID))
  const undo = ChatReact.useAction(props.sessionID, (opened) => opened.undo)
  const redo = ChatReact.useAction(props.sessionID, (opened) => opened.redo)
  const compact = ChatReact.useAction(props.sessionID, (opened) => opened.compact(info?.model))
  const background = ChatReact.useAction(props.sessionID, (opened) => opened.background)
  const restore = (message: Option.Option<SessionMessage.User>) => {
    if (Option.isNone(message)) return
    SessionDrafts.restore(platform, props.sessionID, message.value.text)
    setRestored((count) => count + 1)
  }
  const reverter = useRevert(props.sessionID, restore)
  const onUndo = () => void undo().then(restore, failed("Could not undo the last message"))
  const onRedo = () => void redo().catch(failed("Could not restore the undone messages"))
  const onCompact = () => void compact().catch(failed("Could not compact the chat"))
  const retry = Chat.useRetry(props.sessionID)
  const approving = Chat.useAutoApprove(props.sessionID).enabled
  const people = usePeople(props.organizationId, props.viewer, messages)

  SessionCache.useLive(props.sessionID, liveOf(info, running))

  Attention.useNotify({ running, asking, title })

  useShortcuts({
    sessionID: props.sessionID,
    child: props.child,
    state,
    scroller,
    onBackground: () => void background().catch(failed("Could not move the work to the background")),
    onFind: finder.open,
    onChild: props.onChild,
  })

  return (
    <ConversationShell.Root
      populated={messages.length > 0}
      hidden={props.child !== undefined}
      placeholder={
        AsyncResult.isFailure(session.state) ? (
          <StateMessage state="failed" title="Could not open this chat" onRetry={retry} />
        ) : undefined
      }
      header={
        <>
          <SessionHeader
            state={state}
            sessionID={props.sessionID}
            fallbackTitle={stored.data ?? undefined}
            onOpen={props.onChild}
            onUndo={onUndo}
            onRedo={onRedo}
            onCompact={onCompact}
            onArchived={props.onArchived}
          />
          {finder.bar}
        </>
      }
      timeline={
        <ConversationShell.Timeline
          ref={scroller}
          label="Conversation"
          history={{
            more: ChatState.more(state, props.sessionID),
            loading: ChatState.loadingHistory(state, props.sessionID),
            onLoadOlder: () => void loadMore().catch(failed("Could not load earlier messages")),
          }}
          target={reveal.target}
          hold={reveal.hold}
          onFollowChange={(following) => {
            if (following) props.onFollow()
          }}
          {...transcriptRows({
            view: { root: props.sessionID, sessionID: props.sessionID },
            state,
            messages,
            modelNames,
            part: props.part,
            reverting: reverter.reverting,
            updating: inputs.updating,
            onPending: inputs.act,
            onOpenSession: openSession,
            rows,
            activeMessageID: timeline?.activeMessageID,
            busy: running,
            working: timeline ? Working.show(state, props.sessionID, timeline) : false,
            ...(info?.capabilities.revert !== false && {
              onRevert: reverter.onRevert,
            }),
            onOpenChild: props.onChild,
            detail: props.detail,
            viewer: props.viewer,
            people,
          })}
        />
      }
      interaction={
        <SessionInteraction
          sessionID={props.sessionID}
          state={state}
          reconnecting={view.reconnecting}
          running={running}
          onRedo={onRedo}
          onOpen={props.onChild}
          onAnswered={() => scroller.current?.resume()}
        />
      }
      composer={
        blocked(state, props.sessionID, approving) ? undefined : (
          <SessionComposer
            key={`${props.sessionID}:${restored}`}
            sessionID={props.sessionID}
            state={state}
            unavailable={AsyncResult.isFailure(session.state)}
            onUndo={onUndo}
            onRedo={onRedo}
            onCompact={onCompact}
          />
        )
      }
      overlay={
        props.child ? (
          <SessionChild
            root={props.sessionID}
            sessionID={props.child}
            state={state}
            rootTitle={title}
            onOpen={props.onChild}
          />
        ) : undefined
      }
    />
  )
}
