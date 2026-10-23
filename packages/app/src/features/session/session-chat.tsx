import { Family, SessionTasks, type TimelineDetail, type TimelineRow, TimelineSearch, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import type { SessionMessage } from "@ren/schema/session/message"
import { Button } from "@ren/ui/button"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { FindBar } from "@ren/ui/find-bar"
import { Notice } from "@ren/ui/notice"
import { StateMessage } from "@ren/ui/state-message"
import { TaskProgress, type TaskStatus } from "@ren/ui/task-progress"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { DateTime, Effect, Option, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useDeferredValue, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { Auth } from "../../lib/auth.js"
import { Chat } from "../../lib/chat.js"
import { RouterContext } from "../../lib/router-context.js"
import { SessionCache } from "../../lib/session-cache.js"
import { Attention } from "../../lib/attention.js"
import { Keyboard } from "../../platform/keyboard.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"
import { ChatView } from "./chat-view.js"
import { Failure } from "./failure.js"
import { SessionChild } from "./session-child.js"
import { SessionComposer } from "./session-composer.js"
import { SessionDrafts } from "./session-drafts.js"
import { SessionHeader } from "./session-header.js"
import { SessionKeys } from "./session-keys.js"
import { SessionRequests } from "./session-requests.js"
import { SessionTitle } from "./session-title.js"
import { useTranscriptRows } from "./transcript-rows.js"
import { Timeline } from "./timeline.js"

function useShortcuts(input: {
  child: Session.ID | undefined
  childParent: Session.ID | undefined
  blocking: boolean
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
      blocking: input.blocking,
    })
    if (!intent || (intent === "parent" && Keyboard.isTyping(event))) return
    event.preventDefault()
    const run: Readonly<Record<SessionKeys.Intent, () => void>> = {
      previous: () => input.scroller.current?.step(-1),
      next: () => input.scroller.current?.step(1),
      background: input.onBackground,
      find: input.onFind,
      parent: () => input.onChild(input.childParent),
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

function Tasks(props: { tasks: ReadonlyArray<SessionTasks.Task>; running: boolean }) {
  if (props.tasks.length === 0 || !(props.running || SessionTasks.unfinished(props.tasks))) return null
  return (
    <TaskProgress
      tasks={props.tasks.map((task) => ({ id: task.id, content: task.content, status: taskStatus[task.status] }))}
    />
  )
}

function SessionInteraction(props: {
  tasks: ReadonlyArray<SessionTasks.Task>
  reconnecting: boolean
  running: boolean
  reverted: boolean
  onRedo: () => void
  children: ReactNode
}) {
  return (
    <>
      <Tasks tasks={props.tasks} running={props.running} />
      {props.reconnecting ? (
        <output>
          <Text purpose="caption" tone="secondary">
            Reconnecting
          </Text>
        </output>
      ) : null}
      {props.reverted ? (
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
      {props.children}
    </>
  )
}

const blocked = (
  requests: ReturnType<typeof ChatView.useRoot>["requests"],
  permissions: { readonly approving: boolean },
) => Boolean((permissions.approving ? undefined : requests.permission) ?? requests.form)

interface Find {
  readonly value: string
  readonly active: number
}

const findTarget = (rows: ReadonlyArray<TimelineRow.Row>, match: TimelineSearch.Match | undefined) => {
  if (!match) return
  if (match.role === "user") return Timeline.rowFor(rows, match.messageID)
  return Timeline.rowForPart(rows, (reference) => reference.partID === match.partID)
}

const partTarget = (
  rows: ReadonlyArray<TimelineRow.Row>,
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

function useFind(messages: ReadonlyArray<SessionMessage.Info>, rows: ReadonlyArray<TimelineRow.Row>) {
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
      .catch(
        Failure.toast(action === "queue" ? "Could not move the message to the queue" : "Could not delete the message"),
      )
      .finally(() => setUpdating((previous) => new Set([...previous].filter((id) => id !== message.id))))
  }
  return { updating, act }
}

function useOpenSession(input: {
  sessionID: Session.ID
  onChild: (sessionID: Session.ID) => void
  onNavigate: (sessionID: Session.ID) => void
}) {
  const context = RouterContext.useRouterContext()
  const family = ChatReact.useAction(input.sessionID, (opened) =>
    Effect.map(SubscriptionRef.get(opened.state), (current) => Family.tree(current, input.sessionID)),
  )
  return (id: string) => {
    if (id === input.sessionID) return
    void family().then((tree) => {
      if (tree.includes(id)) return input.onChild(Session.ID.make(id))
      void context.queryClient.query(context.api.session.get.queryOptions({ idOrSlug: id })).then(
        (found) => input.onNavigate(Session.ID.make(found.id)),
        () => Toast.manager.add({ type: "error", title: "Could not find that chat" }),
      )
    })
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
        .then(restore, Failure.toast("Could not revert to this message"))
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

const liveOf = (info: SessionInfo.Info | undefined, session: { readonly running: boolean }): SessionCache.Live => {
  if (!info) return { title: undefined, status: undefined }
  return { title: SessionTitle.display(info.title, "") || undefined, status: session.running ? "busy" : "idle" }
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
    select: (session) => ({ title: session.title, filesResetAt: session.filesResetAt }),
  })
  const chat = ChatView.useRoot(props.sessionID, props.child)
  const rows = chat.rows
  const messages = chat.messages
  const info = chat.info
  const running = chat.running
  const title = SessionTitle.display(info?.title ?? stored.data?.title, SessionTitle.untitled)
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
    onChild: props.onChild,
    onNavigate: props.onNavigate,
  })
  Chat.useReveal(props.sessionID, props.sessionID, props.message)
  const loadMore = ChatReact.useAction(props.sessionID, (opened) => opened.loadMore(props.sessionID))
  const undo = ChatReact.useAction(props.sessionID, (opened) => opened.undo)
  const redo = ChatReact.useAction(props.sessionID, (opened) => opened.redo)
  const compact = ChatReact.useAction(props.sessionID, (opened) => opened.compact(info?.model))
  const move = ChatReact.useAction(props.sessionID, (opened) => opened.background)
  const restore = (message: Option.Option<SessionMessage.User>) => {
    if (Option.isNone(message)) return
    SessionDrafts.prefill(platform.drafts, SessionDrafts.key(props.sessionID), message.value.text)
    setRestored((count) => count + 1)
  }
  const reverter = useRevert(props.sessionID, restore)
  const onUndo = () => void undo().then(restore, Failure.toast("Could not undo the last message"))
  const onRedo = () => void redo().catch(Failure.toast("Could not restore the undone messages"))
  const onCompact = () => void compact().catch(Failure.toast("Could not compact the chat"))
  const reopen = Chat.useRetry(props.sessionID)
  const restart = useMutation(context.api.chat.retry.mutationOptions())
  const retry = () => {
    const message = SessionDrafts.takePending(platform.drafts, props.sessionID)
    restart.mutate(
      { id: props.sessionID, ...(Option.isSome(message) && { message: message.value }) },
      {
        onSuccess: () => {
          platform.drafts?.remove(SessionDrafts.pending(props.sessionID))
          reopen()
        },
        onError: Failure.toast("Could not start this chat again"),
      },
    )
  }
  const blocking = blocked(chat.requests, { approving: Chat.useAutoApprove(props.sessionID).enabled })
  const people = usePeople(props.organizationId, props.viewer, messages)

  SessionCache.useLive(props.sessionID, liveOf(info, { running }))

  Attention.useNotify({ running, asking: chat.asking, title })

  useShortcuts({
    child: props.child,
    childParent: chat.childParent,
    blocking: chat.background.blocking.length > 0,
    scroller,
    onBackground: () => void move().catch(Failure.toast("Could not move the work to the background")),
    onFind: finder.open,
    onChild: props.onChild,
  })

  const transcript = useTranscriptRows({
    view: { root: props.sessionID, sessionID: props.sessionID },
    statuses: chat.statuses,
    messages,
    modelNames,
    part: props.part,
    reverting: reverter.reverting,
    updating: inputs.updating,
    onPending: inputs.act,
    onOpenSession: openSession,
    rows,
    activeMessageID: chat.activeMessageID,
    busy: running,
    working: chat.working,
    ...(info?.capabilities.revert !== false && {
      onRevert: reverter.onRevert,
    }),
    onOpenChild: props.onChild,
    detail: props.detail,
    viewer: props.viewer,
    people,
    filesResetAt: stored.data?.filesResetAt ? DateTime.makeUnsafe(stored.data.filesResetAt) : null,
  })

  return (
    <ConversationShell.Root
      populated={messages.length > 0}
      hidden={props.child !== undefined}
      placeholder={
        chat.failed ? <StateMessage state="failed" title="Could not open this chat" onRetry={retry} /> : undefined
      }
      header={
        <>
          <SessionHeader
            sessionID={props.sessionID}
            title={title}
            capabilities={info?.capabilities}
            prompted={chat.prompted}
            reverted={chat.reverted}
            background={chat.background}
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
            more: chat.more,
            loading: chat.loadingHistory,
            onLoadOlder: () => void loadMore().catch(Failure.toast("Could not load earlier messages")),
          }}
          target={reveal.target}
          hold={reveal.hold}
          onFollowChange={(following) => {
            if (following) props.onFollow()
          }}
          {...transcript}
        />
      }
      interaction={
        <SessionInteraction
          tasks={chat.tasks}
          reconnecting={chat.reconnecting}
          running={running}
          reverted={chat.reverted}
          onRedo={onRedo}
        >
          <SessionRequests
            root={props.sessionID}
            sessionID={props.sessionID}
            permission={chat.requests.permission}
            permissionTitle={chat.requests.permissionTitle}
            form={chat.requests.form}
            formTitle={chat.requests.formTitle}
            formExpired={chat.requests.formExpired}
            connection={chat.requests.connection}
            onOpen={props.onChild}
            onAnswered={() => scroller.current?.resume()}
          />
        </SessionInteraction>
      }
      composer={
        blocking ? undefined : (
          <SessionComposer
            key={`${props.sessionID}:${restored}`}
            sessionID={props.sessionID}
            info={info}
            running={running}
            pending={chat.pending}
            prompted={chat.prompted}
            reverted={chat.reverted}
            unavailable={chat.failed}
            covered={props.child !== undefined}
            onUndo={onUndo}
            onRedo={onRedo}
            onCompact={onCompact}
          />
        )
      }
      overlay={
        props.child ? (
          <SessionChild root={props.sessionID} sessionID={props.child} rootTitle={title} onOpen={props.onChild} />
        ) : undefined
      }
    />
  )
}
