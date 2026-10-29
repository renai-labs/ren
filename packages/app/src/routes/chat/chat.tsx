import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { IconArrowLeft, IconCopy, IconCube, IconLayoutSidebarRight, IconRestore } from "@tabler/icons-react"
import { toast } from "sonner"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Queue } from "@/components/ren/chat/queue"
import { WorkspacePanel } from "@/components/ren/chat/workspace/workspace-panel"
import { ChatRequests } from "@/components/ren/chat/requests"
import { Transcript } from "@/components/ren/chat/transcript"
import { PromptInput } from "@/components/ren/chat/prompt-input"
import { ModelPicker } from "@/components/ren/model-picker"
import { RowMenu } from "@/components/ren/row-menu"
import { useCanAdminister } from "@/hooks/use-organization"
import { cn } from "@/lib/utils"
import { useChat, useChatPage } from "@/routes/chat/use-chat-page"

type Page = ReturnType<typeof useChat>

function ChatThread(props: { page: Page }) {
  const page = props.page
  const admin = useCanAdminister()
  const [picking, setPicking] = useState(false)
  return (
    <>
      <Transcript
        key={page.view.sessionID}
        view={page.view}
        messages={page.messages}
        rows={page.rows}
        activeMessageID={page.activeMessageID}
        busy={page.busy}
        working={page.working}
        statuses={page.statuses}
        viewer={page.viewer}
        people={page.people}
        more={page.more}
        loadingHistory={page.loadingHistory}
        onLoadMore={page.loadMore}
        onOpenChild={(id) => page.openChild(id)}
        onEdit={page.canRevert && !page.child && !page.reverting ? page.edit : undefined}
        expanded={page.expanded}
        modelNames={page.modelNames}
        admin={admin}
        onTryAgain={page.child ? undefined : page.resend}
        onContinue={page.child ? undefined : () => page.resend("Continue.")}
        onChangeModel={page.child || !page.canChooseModel ? undefined : () => setPicking(true)}
        onStop={page.stop}
        empty={page.child ? "This subagent hasn’t posted anything. It may have stopped before it started." : undefined}
      />
      <div className="px-6 pb-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {page.tasks.length > 0 && !page.child ? <Queue tasks={page.tasks} running={page.running} /> : null}
          {page.reverted && !page.child ? (
            <Alert>
              <IconRestore />
              <AlertDescription>Later messages are undone. Sending a message discards them.</AlertDescription>
              <AlertAction>
                <Button size="sm" variant="outline" onClick={page.restore}>
                  Restore messages
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          <ChatRequests
            root={page.root}
            sessionID={page.view.sessionID}
            permission={page.requests.permission}
            permissionTitle={page.requests.permissionTitle}
            form={page.requests.form}
            formTitle={page.requests.formTitle}
            formExpired={page.requests.formExpired}
            onOpen={(id) => page.openChild(id)}
          />
          {page.blocked || page.child ? null : (
            <PromptInput
              placement="chat"
              spaceId={page.spaceId}
              value={page.draft}
              onChange={page.setDraft}
              onSubmit={page.send}
              boot={page.bootStatus}
              onRetry={page.retry}
              running={page.running}
              onStop={page.stop}
              suggest={page.suggest}
              model={
                page.canChooseModel ? (
                  <ModelPicker
                    models={page.models}
                    value={page.model}
                    loading={page.modelsLoading}
                    onChange={page.chooseModel}
                    open={picking}
                    onOpenChange={setPicking}
                  />
                ) : null
              }
            />
          )}
        </div>
      </div>
    </>
  )
}

export function ChatPage() {
  const page = useChatPage()
  const [panel, setPanel] = useState(false)
  const [maximized, setMaximized] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 [--panel-width:clamp(24rem,40vw,40rem)]">
      <div className={panel && maximized ? "hidden" : "flex min-w-0 flex-1 flex-col"}>
        <header className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2 group-has-[[data-slot=sidebar][data-state=collapsed]]/sidebar-wrapper:pl-11 max-md:pl-11">
          {page.child ? (
            <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => page.openChild(undefined)}>
              <IconArrowLeft />
              {page.childTitle ?? "Subagent"}
            </Button>
          ) : (
            <Breadcrumb className="mr-auto flex h-8 items-center rounded-lg border bg-sidebar px-3">
              <BreadcrumbList>
                <BreadcrumbItem>
                  {page.spaceId ? (
                    <BreadcrumbLink
                      className="flex items-center gap-1.5"
                      render={<Link to="/spaces/$spaceId" params={{ spaceId: page.spaceId }} />}
                    >
                      <IconCube className="size-4" />
                      {page.spaceName}
                    </BreadcrumbLink>
                  ) : (
                    <Skeleton className="h-4 w-24" />
                  )}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          )}
          <RowMenu
            label="Chat actions"
            className="flex text-muted-foreground"
            items={[
              {
                label: "Copy link",
                icon: <IconCopy className="text-muted-foreground" />,
                onSelect: () =>
                  void navigator.clipboard.writeText(window.location.href).then(
                    () => toast.success("Link copied"),
                    () => toast.error("Couldn’t copy the link", { description: window.location.href }),
                  ),
              },
            ]}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={panel ? "Close panel" : "Open panel"}
            aria-pressed={panel}
            className="text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
            onClick={() => setPanel((current) => !current)}
          >
            <IconLayoutSidebarRight />
          </Button>
        </header>
        {page.failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            Ren couldn’t open this chat.
            <Button variant="outline" disabled={page.retrying} onClick={page.retry}>
              Try again
            </Button>
          </div>
        ) : (
          <ChatThread page={page} />
        )}
      </div>
      <div
        inert={!panel}
        className={cn(
          "shrink-0 overflow-hidden transition-[width] duration-200 ease-linear motion-reduce:transition-none",
          panel ? (maximized ? "flex-1" : "w-(--panel-width)") : "w-0",
        )}
      >
        <div className={cn("h-full", maximized ? "w-full" : "w-(--panel-width)")}>
          <WorkspacePanel
            messages={page.messages}
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
  const page = useChat(props.sessionId, {})
  return <ChatThread page={page} />
}
