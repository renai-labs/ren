import { useState } from "react"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconCube, IconLayoutSidebarRight, IconRestore } from "@tabler/icons-react"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from "@ren/ui/breadcrumb"
import { Button } from "@ren/ui/button"
import { Skeleton } from "@ren/ui/skeleton"
import { Queue } from "./queue.js"
import { WorkspacePanel } from "./workspace-panel.js"
import { ChatActions } from "./chat-actions.js"
import { ChatRequests } from "./requests.js"
import { Transcript } from "./transcript.js"
import { PromptInput } from "./prompt-input.js"
import { ModelPicker } from "../../components/model-picker.js"
import { useCanAdminister } from "../../lib/use-organization.js"
import { cn } from "cn"
import { useChat } from "./use-chat.js"

const route = getRouteApi("/_authed/_shell/sessions/$sessionId/")

type Chat = ReturnType<typeof useChat>

function ChatThread(props: { chat: Chat }) {
  const chat = props.chat
  const admin = useCanAdminister()
  const [picking, setPicking] = useState(false)
  return (
    <>
      <Transcript
        key={chat.view.sessionID}
        view={chat.view}
        messages={chat.messages}
        rows={chat.rows}
        activeMessageID={chat.activeMessageID}
        busy={chat.busy}
        working={chat.working}
        statuses={chat.statuses}
        viewer={chat.viewer}
        people={chat.people}
        more={chat.more}
        loadingHistory={chat.loadingHistory}
        onLoadMore={chat.loadMore}
        onOpenChild={(id) => chat.openChild(id)}
        onEdit={chat.canRevert && !chat.child && !chat.reverting ? chat.edit : undefined}
        expanded={chat.expanded}
        modelNames={chat.modelNames}
        admin={admin}
        onTryAgain={chat.child ? undefined : chat.resend}
        onContinue={chat.child ? undefined : () => chat.resend("Continue.")}
        onChangeModel={chat.child || !chat.canChooseModel ? undefined : () => setPicking(true)}
        onStop={chat.stop}
        empty={chat.child ? "This subagent hasn’t posted anything. It may have stopped before it started." : undefined}
      />
      <div className="px-6 pb-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <ChatComposer chat={chat} picking={picking} onPickingChange={setPicking} />
        </div>
      </div>
    </>
  )
}

function ChatComposer(props: { chat: Chat; picking: boolean; onPickingChange: (open: boolean) => void }) {
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
          onSubmit={chat.send}
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
                open={props.picking}
                onOpenChange={props.onPickingChange}
              />
            ) : null
          }
        />
      )}
    </>
  )
}

function ChatHeader(props: { chat: Chat; panel: boolean; onTogglePanel: () => void }) {
  const chat = props.chat
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2 group-has-[[data-slot=sidebar][data-state=collapsed]]/sidebar-wrapper:pl-11 max-md:pl-11">
      {chat.child ? (
        <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => chat.openChild(undefined)}>
          <IconArrowLeft />
          {chat.childTitle ?? "Subagent"}
        </Button>
      ) : (
        <Breadcrumb className="mr-auto flex h-8 items-center rounded-lg border bg-sidebar px-3">
          <BreadcrumbList>
            <BreadcrumbItem>
              {chat.spaceId ? (
                <BreadcrumbLink
                  className="flex items-center gap-1.5"
                  render={<Link to="/spaces/$spaceId" params={{ spaceId: chat.spaceId }} />}
                >
                  <IconCube className="size-4" />
                  {chat.spaceName}
                </BreadcrumbLink>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}
      {chat.child ? null : (
        <ChatActions
          sessionId={chat.root}
          title={chat.title}
          spaceId={chat.spaceId}
          capabilities={chat.capabilities}
          prompted={chat.prompted}
          reverted={chat.reverted}
          onUndo={chat.undo}
          onRestore={chat.restore}
          onCompact={chat.compact}
          onArchive={chat.archive}
        />
      )}
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
    </header>
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
      <div className={panel && maximized ? "hidden" : "flex min-w-0 flex-1 flex-col"}>
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

export function SessionThread(props: { sessionId: string }) {
  const chat = useChat(props.sessionId, {})
  return <ChatThread chat={chat} />
}
