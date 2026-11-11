import { useState, type ReactNode } from "react"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconCube, IconGhostFilled, IconLayoutSidebarRight, IconRestore } from "@tabler/icons-react"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Badge } from "@ren/ui/badge"
import { Breadcrumb } from "../../components/breadcrumb.js"
import { Button } from "@ren/ui/button"
import { Queue } from "./queue.js"
import { WorkspacePanel } from "./workspace-panel.js"
import { TurnRail } from "./turn-rail.js"
import { ChatActions } from "./chat-actions.js"
import { ChatRequests } from "./requests.js"
import { Transcript } from "./transcript.js"
import { PromptInput } from "./prompt-input.js"
import { ModelPicker } from "../../components/model-picker.js"
import { useCanAdminister } from "../../lib/use-organization.js"
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
        key={chat.view.sessionID}
        view={chat.view}
        spaceId={chat.spaceId}
        messages={chat.messages}
        rows={chat.rows}
        activeMessageID={chat.activeMessageID}
        busy={chat.busy}
        working={chat.working}
        statuses={chat.statuses}
        viewer={chat.viewer}
        people={chat.people}
        more={chat.more}
        loading={chat.rows.length === 0 && (chat.loading || chat.more || chat.loadingHistory)}
        loadingHistory={chat.loadingHistory}
        onLoadMore={chat.loadMore}
        find={find}
        onOpenChild={(id) => chat.openChild(id)}
        onEdit={chat.canRevert && !chat.child && !chat.reverting ? chat.edit : undefined}
        expanded={chat.expanded}
        modelNames={chat.modelNames}
        admin={admin}
        onTryAgain={chat.child ? undefined : chat.resend}
        onContinue={chat.child ? undefined : () => chat.resend("Continue.")}
        onConnected={chat.connected}
        onChangeModel={chat.child || !chat.canChooseModel ? undefined : () => chat.setPicking(true)}
        onStop={chat.stop}
        empty={chat.child ? "This subagent hasn’t posted anything. It may have stopped before it started." : undefined}
      />
      <div className="px-6 pb-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <ChatComposer chat={chat} dock={props.dock} />
        </div>
      </div>
    </>
  )
}

function ChatComposer(props: { chat: Chat; dock?: ReactNode }) {
  const chat = props.chat
  return (
    <>
      {chat.tasks.length > 0 && !chat.child ? <Queue tasks={chat.tasks} running={chat.running} /> : null}
      {chat.reverted && !chat.child ? (
        <Alert>
          <IconRestore />
          <AlertDescription>Later messages are undone. Sending a message discards them.</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={chat.restore}>
              Restore messages
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {chat.child ? null : props.dock}
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
      {chat.blocked || chat.child ? null : (
        <PromptInput
          placement="chat"
          spaceId={chat.spaceId}
          value={chat.draft}
          onChange={chat.setDraft}
          files={chat.files}
          onSubmit={chat.send}
          onChooseModel={chat.canChooseModel ? () => chat.setPicking(true) : undefined}
          boot={chat.bootStatus}
          onRetry={chat.retry}
          running={chat.running}
          onStop={chat.stop}
          suggest={chat.suggest}
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
    </>
  )
}

function useCustomAgentName(root: Session.ID) {
  const agents = useAgents()
  const agent = useRunningAgent(root)
  if (!agent || agent === "ren") return
  return agents.agents.find((each) => each.name === agent)?.name
}

function ChatHeader(props: { chat: Chat; panel: boolean; onTogglePanel: () => void }) {
  const chat = props.chat
  const [renaming, setRenaming] = useState(false)
  const agent = useCustomAgentName(chat.root)
  return (
    <Breadcrumb.Header>
      {chat.child ? (
        <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => chat.openChild(undefined)}>
          <IconArrowLeft />
          {chat.childTitle ?? "Subagent"}
        </Button>
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
              editing={renaming}
              onEditingChange={setRenaming}
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
      <ChatActions
        sessionId={chat.child ?? chat.root}
        archive={chat.child ? undefined : { title: chat.title, onArchive: chat.archive }}
        onRename={chat.child || !chat.canRename ? undefined : () => setRenaming(true)}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={props.panel ? "Close panel" : "Open panel"}
        aria-pressed={props.panel}
        className="text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
        onClick={props.onTogglePanel}
      >
        <IconLayoutSidebarRight />
      </Button>
    </Breadcrumb.Header>
  )
}

function panelWidth(panel: { readonly open: boolean; readonly maximized: boolean }) {
  if (!panel.open) return "w-0"
  return panel.maximized ? "flex-1" : "w-(--panel-width)"
}

export function ChatPage() {
  const params = route.useParams()
  const search = route.useSearch()
  const navigate = useNavigate()
  const chat = useChat(params.sessionId, {
    child: search.child,
    onChild: (id) =>
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: params.sessionId },
        search: id ? { child: id } : {},
      }),
    onArchived: () => void navigate({ to: "/" }),
  })
  const [panel, setPanel] = useState(false)
  const [maximized, setMaximized] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 [--panel-width:clamp(--spacing(96),40vw,--spacing(160))]">
      <div className={panel && maximized ? "hidden" : "relative flex min-w-0 flex-1 flex-col"}>
        <ChatHeader chat={chat} panel={panel} onTogglePanel={() => setPanel((current) => !current)} />
        {chat.failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            Ren couldn’t open this chat.
            <Button variant="outline" disabled={chat.retrying} onClick={chat.retry}>
              Try again
            </Button>
          </div>
        ) : (
          <ChatThread chat={chat} />
        )}
        {chat.child ? null : <TurnRail messages={chat.messages} />}
      </div>
      <div
        inert={!panel}
        className={cn(
          "shrink-0 overflow-hidden transition-[width] duration-200 ease-linear motion-reduce:transition-none",
          panelWidth({ open: panel, maximized }),
        )}
      >
        <div className={cn("h-full", maximized ? "w-full" : "w-(--panel-width)")}>
          <WorkspacePanel
            root={chat.root}
            messages={chat.messages}
            maximized={maximized}
            onMaximize={setMaximized}
            onClose={() => {
              setPanel(false)
              setMaximized(false)
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
