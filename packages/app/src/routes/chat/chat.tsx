import { useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { IconArrowLeft, IconCube, IconFileText, IconLink, IconRestore, IconShare, IconX } from "@tabler/icons-react"
import { toast } from "sonner"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Queue } from "@/components/ren/chat/queue"
import { ChatRequests } from "@/components/ren/chat/requests"
import { Transcript } from "@/components/ren/chat/transcript"
import { PromptInput } from "@/components/ren/chat/prompt-input"
import { ModelPicker } from "@/components/ren/model-picker"
import { RowMenu } from "@/components/ren/row-menu"
import { useChat, useChatPage } from "@/routes/chat/use-chat-page"

type Page = ReturnType<typeof useChat>

function ArtifactRow(props: {
  icon: ReactNode
  title: string
  detail: string
  href?: string | undefined
  actions: ReadonlyArray<{ label: string; onSelect: () => void }>
}) {
  const body = (
    <>
      <span className="truncate text-sm">{props.title}</span>
      <span className="truncate text-xs text-muted-foreground">{props.detail}</span>
    </>
  )
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&_svg]:size-4">
        {props.icon}
      </span>
      {props.href ? (
        <a href={props.href} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 flex-col">
          {body}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
      )}
      <RowMenu label="Artifact actions" items={props.actions} />
    </div>
  )
}

function Artifacts(props: { links: ReadonlyArray<string>; files: ReadonlyArray<string>; onClose: () => void }) {
  const copy = (text: string, done: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.success(done),
      () => toast.error("Couldn’t copy", { description: text }),
    )
  return (
    <aside
      aria-label="Artifacts"
      className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain border-l p-4"
    >
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close artifacts"
          className="text-muted-foreground"
          onClick={props.onClose}
        >
          <IconX />
        </Button>
      </div>
      {props.links.length === 0 && props.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Files and links this chat makes show up here.</p>
      ) : null}
      {props.files.length > 0 ? (
        <>
          <h2 className="text-xs text-muted-foreground uppercase">Files</h2>
          {props.files.map((path) => (
            <ArtifactRow
              key={path}
              icon={<IconFileText />}
              title={path.split("/").at(-1) ?? path}
              detail={path}
              actions={[{ label: "Copy path", onSelect: () => copy(path, "Path copied") }]}
            />
          ))}
        </>
      ) : null}
      {props.links.length > 0 ? (
        <>
          <h2 className="text-xs text-muted-foreground uppercase">Links</h2>
          {props.links.map((url) => (
            <ArtifactRow
              key={url}
              icon={<IconLink />}
              title={URL.parse(url)?.host ?? url}
              detail={url}
              href={url}
              actions={[
                { label: "Copy link", onSelect: () => copy(url, "Link copied") },
                { label: "Open", onSelect: () => void window.open(url, "_blank", "noopener,noreferrer") },
              ]}
            />
          ))}
        </>
      ) : null}
    </aside>
  )
}

function ChatThread(props: { page: Page }) {
  const page = props.page
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
  const [artifacts, setArtifacts] = useState(false)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2 group-has-[[data-slot=sidebar][data-state=collapsed]]/sidebar-wrapper:pl-11 max-md:pl-11">
          {page.child ? (
            <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => page.openChild(undefined)}>
              <IconArrowLeft />
              {page.childTitle ?? "Subagent"}
            </Button>
          ) : (
            <Breadcrumb className="mr-auto flex h-8 items-center rounded-lg border px-3">
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Artifacts"
            aria-pressed={artifacts}
            className="text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
            onClick={() => setArtifacts((current) => !current)}
          >
            <IconFileText />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Share replay link"
            className="text-muted-foreground"
            onClick={() =>
              void navigator.clipboard.writeText(window.location.href).then(
                () => toast.success("Replay link copied"),
                () => toast.error("Couldn’t copy the link", { description: window.location.href }),
              )
            }
          >
            <IconShare />
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
      {artifacts ? <Artifacts links={page.links} files={page.files} onClose={() => setArtifacts(false)} /> : null}
    </div>
  )
}

export function SessionThread(props: { sessionId: string }) {
  const page = useChat(props.sessionId, {})
  return <ChatThread page={page} />
}
