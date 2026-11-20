import { useRef, useState, type ReactNode } from "react"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { IconCube, IconGhostFilled, IconLayoutSidebarRight, IconRestore } from "@tabler/icons-react"
import { Composer, Mentions } from "@ren/chat"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Badge } from "@ren/ui/badge"
import { Breadcrumb } from "../../components/breadcrumb.js"
import { Button } from "@ren/ui/button"
import { ResizeHandle } from "@ren/ui/resize-handle"
import { ActivityPill } from "./activity-pill.js"
import { Queue } from "./queue.js"
import { QueuedMessages } from "./queued-messages.js"
import { OpenPanel } from "./open-panel.js"
import { useTerminalShells } from "./terminal-shells.js"
import { WorkspacePanel, type PanelRequest, type PanelTarget } from "./workspace-panel.js"
import { TurnRail } from "./turn-rail.js"
import { ContextUsage } from "./context-usage.js"
import { ChatActions } from "./chat-actions.js"
import { ChatRequests } from "./requests.js"
import { Transcript } from "./transcript.js"
import { PromptInput } from "./prompt-input.js"
import { useChatKeys } from "./use-chat-keys.js"
import { ModelPicker } from "../../components/model-picker.js"
import { useCanAdminister } from "../../lib/use-organization.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { ChatWorkspace } from "../../lib/chat-workspace.js"
import { Preference } from "../../lib/preference.js"
import { cn } from "cn"
import { useChat } from "./use-chat.js"
import { useFind } from "./use-find.js"
import type { Session } from "@ren/schema/session"
import { useAgents } from "../../lib/use-agents.js"
import { useRunningAgent } from "./chat-view.js"

const route = getRouteApi("/_authed/_shell/sessions/$sessionId/")

type Chat = ReturnType<typeof useChat>

function ChatThread(props: { chat: Chat; dock?: ReactNode }) {
  const chat = props.chat
  const terminal = useTerminalShells(chat.root)
  // oxlint-disable-next-line ren/no-comments -- A command run in the Terminal tab keeps the session busy, but it is not Ren's work, so the chat shows no running turn for it.
  const terminalOnly =
    chat.activity.length > 0 &&
    chat.activity.every((item) => item.type === "shell" && terminal.has({ id: item.id, command: item.label }))
  const keys = useChatKeys()
  const admin = useCanAdminister()
  const find = useFind({
    messages: chat.messages,
    rows: chat.rows,
    more: chat.more,
    loadingHistory: chat.loadingHistory,
    onSearchEarlier: chat.loadAll,
  })
  return (
    <>
      <Transcript
        handle={keys.transcript}
        key={chat.view.sessionID}
        view={chat.view}
        files={chat.canReadFiles}
        spaceId={chat.spaceId}
        messages={chat.messages}
        rows={chat.rows}
        activeMessageID={chat.activeMessageID}
        busy={chat.busy && !terminalOnly}
        working={chat.working && !terminalOnly}
        starting={chat.starting}
        asking={chat.blocked}
        simple={chat.simple}
        waiting={chat.waiting}
        statuses={chat.statuses}
        viewer={chat.viewer}
        people={chat.people}
        more={chat.more}
        loading={chat.opening}
        loadingHistory={chat.loadingHistory}
        onLoadMore={chat.loadMore}
        find={find}
        onOpenChild={(id) => chat.openChild(id)}
        onRetry={chat.retryUnsent}
        onRemove={chat.removeUnsent}
        onEdit={chat.canRevert && !chat.child && !chat.reverting ? chat.edit : undefined}
        fold={chat.fold}
        detail={chat.detail}
        foldMessages={chat.foldMessages}
        modelNames={chat.modelNames}
        admin={admin}
        onTryAgain={chat.child ? undefined : chat.resend}
        onContinue={chat.child ? undefined : () => chat.resend("Continue.")}
        onConnected={chat.connected}
        onChangeModel={chat.child || !chat.canChooseModel ? undefined : () => chat.setPicking(true)}
        onStop={chat.stop}
        background={chat.background}
        quote={chat.quote}
        empty={chat.child ? "This subagent hasn’t posted anything. It may have stopped before it started." : undefined}
      />
      <div className="px-6 pb-4">
        <ChatComposer chat={chat} dock={props.dock} onComposer={keys.composer} onDock={keys.dock} />
      </div>
    </>
  )
}

function UndoneAlert(props: { chat: Chat }) {
  const chat = props.chat
  if (!chat.reverted || chat.reverting) return null
  return (
    <Alert>
      <IconRestore />
      <AlertDescription>Later messages are undone. Sending a message discards them.</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={chat.restore}>
          Restore messages
        </Button>
      </AlertAction>
    </Alert>
  )
}

function ChatComposer(props: {
  chat: Chat
  dock?: ReactNode
  onComposer: (node: HTMLTextAreaElement | null) => void
  onDock: (node: HTMLDivElement | null) => void
}) {
  const chat = props.chat
  const column = useRef<HTMLDivElement>(null)
  const terminal = useTerminalShells(chat.root)
  return (
    <div
      ref={column}
      className="mx-auto flex w-full max-w-[calc(var(--container-chat)-(--spacing(12)))] flex-col gap-2"
    >
      {chat.backgroundActivity === "off" || chat.child ? null : (
        <ActivityPill
          key={chat.root}
          root={chat.root}
          items={chat.activity.filter(
            (item) =>
              (item.type === "subagent" || !(chat.simple && item.blocking)) &&
              !(item.type === "shell" && terminal.has({ id: item.id, command: item.label })),
          )}
          align={chat.backgroundActivity}
          composer={column}
          onOpenChild={chat.openChild}
        />
      )}
      {chat.tasks.length > 0 && !chat.child ? <Queue tasks={chat.tasks} running={chat.running} /> : null}
      {chat.child ? null : <UndoneAlert chat={chat} />}
      {chat.child ? null : props.dock}
      <div ref={(node) => props.onDock(node)} className="contents">
        <ChatRequests
          root={chat.root}
          sessionID={chat.view.sessionID}
          permission={chat.requests.permission}
          permissionTitle={chat.requests.permissionTitle}
          form={chat.requests.form}
          formTitle={chat.requests.formTitle}
          formExpired={chat.requests.formExpired}
          onOpen={(id) => chat.openChild(id)}
        />
      </div>
      {chat.blocked || chat.child ? null : (
        <PromptInput
          textareaRef={props.onComposer}
          placement="chat"
          spaceId={chat.spaceId}
          value={chat.draft}
          onChange={chat.setDraft}
          files={chat.files}
          onSubmit={chat.send}
          onChooseModel={chat.canChooseModel ? () => chat.setPicking(true) : undefined}
          boot={chat.bootStatus}
          preparing={chat.preparing}
          onRetry={chat.retry}
          onRetryNow={chat.retryNow}
          running={chat.running}
          onStop={chat.stop}
          suggest={chat.suggest}
          queue={<QueuedMessages items={chat.queued} onRemove={chat.removeQueued} onSendNow={chat.sendQueuedNow} />}
          history={chat.shellHistory}
          apps={chat.apps}
          model={
            chat.canChooseModel ? (
              <ModelPicker
                models={chat.models}
                value={chat.model}
                loading={chat.modelsLoading}
                onChange={chat.chooseModel}
                open={chat.picking}
                onOpenChange={chat.setPicking}
              />
            ) : null
          }
        />
      )}
    </div>
  )
}

function useCustomAgentName(root: Session.ID) {
  const agents = useAgents()
  const agent = useRunningAgent(root)
  if (!agent || agent === "ren") return
  return agents.agents.find((each) => each.name === agent)?.name
}

function ChatHeader(props: {
  chat: Chat
  panel: boolean
  renaming: boolean
  onRenamingChange: (renaming: boolean) => void
  onTogglePanel: () => void
}) {
  const chat = props.chat
  const agent = useCustomAgentName(chat.root)
  return (
    <Breadcrumb.Header>
      {chat.child ? (
        <div className="mr-auto flex min-w-0 items-center">
          <Breadcrumb.Root
            ancestors={[
              {
                key: "parent",
                content: <Breadcrumb.Action onClick={() => chat.openChild(undefined)}>{chat.title}</Breadcrumb.Action>,
              },
            ]}
          >
            <span className="block truncate">{chat.childTitle ?? "Subagent"}</span>
          </Breadcrumb.Root>
        </div>
      ) : (
        <div className="mr-auto flex min-w-0 items-center gap-2 max-md:max-w-full max-md:flex-1">
          <Breadcrumb.Root
            ancestorsFrom="md"
            ancestors={[
              {
                key: "space",
                content: chat.spaceId ? (
                  <Link to="/spaces/$spaceId" params={{ spaceId: chat.spaceId }}>
                    <IconCube className="size-4" />
                    {chat.spaceName}
                  </Link>
                ) : (
                  <>
                    <IconCube className="size-4" />
                    Chat
                  </>
                ),
              },
            ]}
          >
            <Breadcrumb.Editable
              value={chat.title}
              label="Chat title"
              tooltip={false}
              required
              readOnly={!chat.canRename}
              editing={props.renaming}
              onEditingChange={props.onRenamingChange}
              onCommit={chat.rename}
            />
          </Breadcrumb.Root>
          {agent ? (
            <Badge variant="outline" className="shrink-0 max-md:hidden">
              <IconGhostFilled />
              {agent}
            </Badge>
          ) : null}
        </div>
      )}
      <ContextUsage
        sessionId={chat.root}
        usage={chat.contextUsage}
        onCompact={chat.child || !chat.canCompact ? undefined : chat.compact}
      />
      <ChatActions
        sessionId={chat.child ?? chat.root}
        archive={chat.child ? undefined : { title: chat.title, onArchive: chat.archive }}
        onRename={chat.child || !chat.canRename ? undefined : () => props.onRenamingChange(true)}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={props.panel ? "Close panel" : "Open panel"}
        aria-pressed={props.panel}
        className="text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
        onClick={props.onTogglePanel}
      >
        <IconLayoutSidebarRight stroke={2.25} />
      </Button>
    </Breadcrumb.Header>
  )
}

const panelMin = 320

const chatMin = 512

// oxlint-disable-next-line ren/no-comments -- `cqw` is the chat layout's width, so the sidebar's width doesn't count. `clamp` keeps `panelMin` first, so a layout narrower than `panelMin` plus `chatMin` gives the chat less than `chatMin`.
const panelSize = (width: number | null) =>
  `clamp(${panelMin}px, ${width === null ? "min(40vw, 640px)" : `${width}px`}, calc(100cqw - ${chatMin}px))`

function panelWidth(panel: { readonly open: boolean; readonly maximized: boolean }) {
  if (!panel.open) return "w-0"
  return panel.maximized ? "flex-1" : "w-(--panel-width)"
}

export function ChatPage() {
  const params = route.useParams()
  const search = route.useSearch()
  const navigate = useNavigate()
  const workspace = ChatWorkspace.useWorkspace(params.sessionId)
  const panel = workspace.open
  const maximized = workspace.maximized
  const [renaming, setRenaming] = useState(false)
  const [pending, setPending] = useState<{ readonly chat: string; readonly request: PanelRequest }>()
  const request = pending?.chat === params.sessionId ? pending.request : undefined
  const requestPanel = (next: PanelTarget) => {
    workspace.setOpen(true)
    setPending({ chat: params.sessionId, request: { ...next, id: crypto.randomUUID() } })
  }
  const chat = useChat(params.sessionId, {
    child: search.child,
    workspace: {
      openTerminal: () => requestPanel({ kind: "terminal" }),
      openFile: (path) => requestPanel({ kind: "files", path }),
    },
    onRename: () => setRenaming(true),
    onNew: (spaceId) => void navigate({ to: "/", search: spaceId ? { spaceId } : {} }),
    onChild: (id) =>
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: params.sessionId },
        search: id ? { child: id } : {},
      }),
    onArchived: () => void navigate({ to: "/" }),
  })
  const updateDraft = chat.files.update
  const mentionFile = (path: string) =>
    updateDraft((draft) => Composer.withText(draft, Mentions.insertFile(draft.text, path, draft.text.length).text))
  const width = Preference.usePreference(ChatPreferences.panelWidth)
  const setPreference = Preference.useSetPreference()
  const layout = useRef<HTMLDivElement>(null)
  const sizePanel = (node: HTMLDivElement | null, next: number | null) =>
    node?.style.setProperty("--panel-width", panelSize(next))
  return (
    <div
      ref={(node) => {
        layout.current = node
        sizePanel(node, width)
      }}
      className="@container flex min-h-0 flex-1"
    >
      <div className={panel && maximized ? "hidden" : "relative flex min-w-0 flex-1 flex-col"}>
        <ChatHeader
          chat={chat}
          panel={panel}
          renaming={renaming}
          onRenamingChange={setRenaming}
          onTogglePanel={() => workspace.setOpen(!panel)}
        />
        {chat.failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            Ren couldn’t open this chat.
            <Button variant="outline" onClick={chat.reopen}>
              Try again
            </Button>
          </div>
        ) : (
          <OpenPanel value={chat.child ? undefined : requestPanel}>
            <ChatThread chat={chat} />
          </OpenPanel>
        )}
        {chat.child ? null : <TurnRail messages={chat.messages} />}
      </div>
      <div
        inert={!panel}
        className={cn(
          "shrink-0 overflow-hidden transition-[width] duration-200 ease-linear in-data-resizing:transition-none motion-reduce:transition-none",
          panelWidth({ open: panel, maximized }),
        )}
      >
        <div className={cn("relative h-full", maximized ? "w-full" : "w-(--panel-width)")}>
          {panel && !maximized ? (
            <ResizeHandle
              label="Resize panel"
              side="left"
              width={width ?? undefined}
              min={panelMin}
              max={() => (layout.current?.getBoundingClientRect().width ?? window.innerWidth) - chatMin}
              onResize={(next) => {
                layout.current?.setAttribute("data-resizing", "")
                sizePanel(layout.current, next)
              }}
              onCommit={(next) => {
                layout.current?.removeAttribute("data-resizing")
                setPreference(ChatPreferences.panelWidth, next)
              }}
              onReset={() => setPreference(ChatPreferences.panelWidth, null)}
            />
          ) : null}
          <WorkspacePanel
            key={chat.root}
            root={chat.root}
            saved={workspace.panel}
            messages={chat.messages}
            request={request}
            maximized={maximized}
            onMaximize={workspace.setMaximized}
            onMention={mentionFile}
            running={chat.busy}
            onClose={() => {
              workspace.setOpen(false)
              workspace.setMaximized(false)
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function SessionThread(props: { sessionId: string; dock?: ReactNode }) {
  const chat = useChat(props.sessionId, {})
  return <ChatThread chat={chat} dock={props.dock} />
}
