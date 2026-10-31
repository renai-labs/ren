import { Family, SessionTasks, type TimelineDetail, TimelineRow, TimelineSearch, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import { Button } from "@ren/ui/button"
import { FindBar } from "@ren/ui/find-bar"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { MessageScrollerProvider, useMessageScroller, useMessageScrollerVisibility } from "@ren/ui/message-scroller"
import { toast } from "@ren/ui/toast"
import { IconAlertCircle, IconRestore } from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { DateTime, Effect, Option, SubscriptionRef } from "effect"
import { useDeferredValue, useState } from "react"
import type { ReactNode } from "react"
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
import { SessionApps } from "./session-apps.js"
import { SessionChild } from "./session-child.js"
import { SessionComposer } from "./session-composer.js"
import { SessionDrafts } from "./session-drafts.js"
import { SessionHeader } from "./session-header.js"
import { SessionKeys } from "./session-keys.js"
import { SessionRequests } from "./session-requests.js"
import { SessionTitle } from "./session-title.js"
import { SessionTodos } from "./session-todos.js"
import { Transcript } from "./transcript.js"
import { Timeline } from "./timeline.js"
import type { ComposerRepositories } from "./composer-repositories.js"

function SessionShortcuts(props: {
  rows: ReadonlyArray<TimelineRow.Row>
  child: Session.ID | undefined
  childParent: Session.ID | undefined
  blocking: boolean
  onBackground: () => void
  onFind: () => void
  onChild: (sessionID: Session.ID | undefined) => void
}) {
  const scroller = useMessageScroller()
  const current = useMessageScrollerVisibility().currentAnchorId
  const anchors = props.rows.flatMap((row) => (row._tag === "UserMessage" ? [TimelineRow.key(row)] : []))
  const step = (offset: number) => {
    const index = current ? anchors.indexOf(current) : -1
    const next = (index === -1 ? anchors.length : index) + offset
    if (anchors.length === 0 || next < 0 || next > anchors.length) return
    const target = anchors[next]
    if (target === undefined) scroller.scrollToEnd({ behavior: "smooth" })
    else scroller.scrollToMessage(target, { align: "start", behavior: "smooth" })
  }
  Keyboard.useKeyDown((event) => {
    if (event.defaultPrevented) return
    const intent = SessionKeys.intent(event, {
      apple: Viewport.apple,
      child: props.child !== undefined,
      blocking: props.blocking,
    })
    if (!intent || (intent === "parent" && Keyboard.isTyping(event))) return
    event.preventDefault()
    const run: Readonly<Record<SessionKeys.Intent, () => void>> = {
      previous: () => step(-1),
      next: () => step(1),
      background: props.onBackground,
      find: props.onFind,
      parent: () => props.onChild(props.childParent),
    }
    run[intent]()
  })
  return null
}

function SessionInteraction(props: {
  tasks: ReadonlyArray<SessionTasks.Task>
  running: boolean
  reverted: boolean
  onRedo: () => void
  children: ReactNode
}) {
  return (
    <>
      {props.tasks.length > 0 && (props.running || SessionTasks.unfinished(props.tasks)) ? (
        <SessionTodos tasks={props.tasks} running={props.running} />
      ) : null}
      {props.reverted ? (
        <Alert>
          <IconRestore />
          <AlertDescription>Later messages are undone. Sending a message discards them.</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={props.onRedo}>
              Restore messages
            </Button>
          </AlertAction>
        </Alert>
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
        Failure.notify(action === "queue" ? "Could not move the message to the queue" : "Could not delete the message"),
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
        () => toast.add({ type: "error", title: "Could not find that chat" }),
      )
    })
  }
}

function usePrompt(sessionID: Session.ID) {
  return ChatReact.useAction(sessionID, (opened, text: string) =>
    Effect.flatMap(SubscriptionRef.get(opened.state), (current) => {
      const model = current.info[sessionID]?.model
      return opened.prompt({ id: SessionMessage.ID.create(), text, ...(model && { model }) })
    }),
  )
}

function useRevert(input: { sessionID: Session.ID; restore: (message: Option.Option<SessionMessage.User>) => void }) {
  const [reverting, setReverting] = useState(false)
  const revert = ChatReact.useAction(input.sessionID, (opened, messageID: SessionMessage.ID) =>
    opened.revert(messageID),
  )
  const prompt = usePrompt(input.sessionID)
  const run = (work: () => Promise<unknown>) => {
    if (reverting) return
    setReverting(true)
    void work().finally(() => setReverting(false))
  }
  return {
    reverting,
    onRevert: (message: SessionMessage.User) =>
      run(() => revert(message.id).then(input.restore, Failure.notify("Could not revert to this message"))),
    onEdit: (message: SessionMessage.User, text: string) =>
      run(() =>
        revert(message.id)
          .then(() => prompt(text))
          .catch(Failure.notify("Could not edit your message")),
      ),
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
  const me = useRouteContext({ from: "/_authed" }).me.user
  return new Map([
    ...(members.data ?? []).map(
      (member) =>
        [
          member.userId,
          { name: member.user.name || member.user.email || "Member", image: member.user.image ?? undefined },
        ] as const,
    ),
    [viewer, { name: me.name || me.email, image: me.image ?? undefined }] as const,
  ])
}

const liveOf = (info: SessionInfo.Info | undefined, session: { readonly running: boolean }): SessionCache.Live => {
  if (!info) return { title: undefined, status: undefined }
  return { title: SessionTitle.display(info.title, "") || undefined, status: session.running ? "busy" : "idle" }
}

function useModelNames(sessionID: Session.ID) {
  const context = RouterContext.useRouterContext()
  const models = useQuery(context.api.chat.models.queryOptions({ id: sessionID })).data ?? []
  return new Map(models.map((model) => [model.id, model.name]))
}

function OpenFailed(props: { onRetry: () => void }) {
  return (
    <Empty role="alert" className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconAlertCircle className="text-destructive" />
        </EmptyMedia>
        <EmptyTitle>Could not open this chat</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

const revertible = (info: SessionInfo.Info | undefined) => info?.capabilities.revert !== false

function ChildOverlay(props: {
  root: Session.ID
  child: Session.ID | undefined
  rootTitle: string
  onOpen: (sessionID: Session.ID | undefined) => void
}) {
  if (!props.child) return null
  return (
    <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
      <SessionChild root={props.root} sessionID={props.child} rootTitle={props.rootTitle} onOpen={props.onOpen} />
    </div>
  )
}

const filesResetOf = (stored: { readonly filesResetAt: string | null } | undefined) =>
  stored?.filesResetAt ? DateTime.makeUnsafe(stored.filesResetAt) : null

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
  addRepositories?: ComposerRepositories.Dialog | undefined
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
  const [restored, setRestored] = useState(0)
  const finder = useFind(messages, rows)
  const reveal = finder.row ?? partTarget(rows, messages, props.part) ?? Timeline.rowFor(rows, props.message)
  const modelNames = useModelNames(props.sessionID)
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
  const reverter = useRevert({ sessionID: props.sessionID, restore })
  const prompt = usePrompt(props.sessionID)
  const interrupt = ChatReact.useAction(props.sessionID, (opened) => opened.interrupt)
  const admin = useQuery(Auth.canAdministerOptions(RouterContext.useRouterContext().auth)).data === true
  const [picking, setPicking] = useState(false)
  const send = (text: string) => void prompt(text).catch(Failure.notify("Could not send your message"))
  const problems = {
    admin,
    onTryAgain: send,
    onContinue: () => send("Continue."),
    onChangeModel: () => setPicking(true),
    onStop: () => void interrupt().catch(Failure.notify("Could not stop Ren")),
  }
  const onUndo = () => void undo().then(restore, Failure.notify("Could not undo the last message"))
  const onRedo = () => void redo().catch(Failure.notify("Could not restore the undone messages"))
  const onCompact = () => void compact().catch(Failure.notify("Could not compact the chat"))
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
        onError: Failure.notify("Could not start this chat again"),
      },
    )
  }
  const blocking = blocked(chat.requests, { approving: Chat.useAutoApprove(props.sessionID).enabled })
  const people = usePeople(props.organizationId, props.viewer, messages)
  const apps = SessionApps.useMentionable()

  SessionCache.useLive(props.sessionID, liveOf(info, { running }))

  Attention.useNotify({ running, asking: chat.asking, title })

  const hidden = props.child !== undefined
  return (
    <MessageScrollerProvider autoScroll>
      <div
        data-slot="chat"
        className="relative flex min-h-0 w-full flex-1 animate-in flex-col overflow-hidden duration-200 ease-out fade-in-0 motion-reduce:animate-none"
      >
        <div inert={hidden} className="relative flex min-h-0 flex-1 flex-col inert:invisible">
          <header className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2 pl-12 md:pl-3">
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
          </header>
          {chat.failed && messages.length === 0 ? (
            <OpenFailed onRetry={retry} />
          ) : (
            <Transcript
              label="Conversation"
              view={{ root: props.sessionID, sessionID: props.sessionID }}
              statuses={chat.statuses}
              messages={messages}
              rows={rows}
              activeMessageID={chat.activeMessageID}
              busy={running}
              working={chat.working}
              history={{
                more: chat.more,
                loading: chat.loadingHistory,
                onLoadOlder: () => void loadMore().catch(Failure.notify("Could not load earlier messages")),
              }}
              target={reveal}
              modelNames={modelNames}
              part={props.part}
              reverting={reverter.reverting}
              updating={inputs.updating}
              onPending={inputs.act}
              onOpenSession={openSession}
              {...(revertible(info) && { onRevert: reverter.onRevert, onEdit: reverter.onEdit })}
              onOpenChild={props.onChild}
              onFollow={props.onFollow}
              detail={props.detail}
              viewer={props.viewer}
              people={people}
              apps={apps}
              filesResetAt={filesResetOf(stored.data)}
              problems={problems}
            />
          )}
          <div className="shrink-0 px-4 pb-4 md:px-6">
            <div className="mx-auto flex w-full max-w-192 flex-col gap-2">
              <SessionInteraction tasks={chat.tasks} running={running} reverted={chat.reverted} onRedo={onRedo}>
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
                />
              </SessionInteraction>
              {blocking ? null : (
                <SessionComposer
                  key={`${props.sessionID}:${restored}`}
                  sessionID={props.sessionID}
                  info={info}
                  running={running}
                  pending={chat.pending}
                  prompted={chat.prompted}
                  reverted={chat.reverted}
                  unavailable={chat.failed}
                  covered={hidden}
                  notice={chat.notice}
                  retrying={restart.isPending}
                  onRetry={retry}
                  onUndo={onUndo}
                  onRedo={onRedo}
                  onCompact={onCompact}
                  picking={picking}
                  onPicking={setPicking}
                  addRepositories={props.addRepositories}
                />
              )}
            </div>
          </div>
        </div>
        <ChildOverlay root={props.sessionID} child={props.child} rootTitle={title} onOpen={props.onChild} />
        <SessionShortcuts
          rows={rows}
          child={props.child}
          childParent={chat.childParent}
          blocking={chat.background.blocking.length > 0}
          onBackground={() => void move().catch(Failure.notify("Could not move the work to the background"))}
          onFind={finder.open}
          onChild={props.onChild}
        />
      </div>
    </MessageScrollerProvider>
  )
}
