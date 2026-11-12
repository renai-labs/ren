import { lazy, Suspense, useState } from "react"
import { ChatReact } from "@ren/chat/react"
import { FileTabs } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import { IconArrowLeft, IconDots, IconFile, IconFiles, IconFolder, IconRefresh, IconX } from "@tabler/icons-react"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import { Theme } from "../../components/theme.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { errorMessage, errorStatus } from "../../lib/errors.js"
import { formatBytes } from "../../lib/format.js"
import { useRefreshOn } from "../../lib/use-refresh-on.js"
import { Platform } from "../../platform/platform.js"
import { editsOf } from "./workspace-edits.js"
import { WorkspacePending } from "./workspace-state.js"

const highlightLimit = 256 * 1024

const FileView = lazy(() => import("@ren/ui/file-view").then((module) => ({ default: module.FileView })))

const nameOf = (path: string) => path.replace(/\/$/u, "").split("/").at(-1) ?? path

const parentOf = (folder: string) => folder.replace(/[^/]+\/$/u, "")

function Folder(props: {
  root: Session.ID
  folder: string
  selected: string | undefined
  onFolder: (folder: string) => void
  onFile: (path: string) => void
  onPin: (path: string) => void
}) {
  const listed = ChatReact.useFolder({ root: props.root, path: props.folder })
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3 text-xs text-muted-foreground">
        {props.folder ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open the parent folder"
            className="-ml-1.5 text-muted-foreground"
            onClick={() => props.onFolder(parentOf(props.folder))}
          >
            <IconArrowLeft />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono" title={props.folder || "/"}>
          {props.folder || "/"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh files"
          className="text-muted-foreground"
          onClick={listed.refresh}
        >
          <IconRefresh />
        </Button>
      </div>
      {AsyncResult.isSuccess(listed.result) ? (
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
          {listed.result.value.map((entry: SessionCatalog.File) => (
            <li key={entry.path}>
              <Button
                variant="ghost"
                size="sm"
                aria-current={entry.path === props.selected || undefined}
                onClick={() => (entry.type === "directory" ? props.onFolder(entry.path) : props.onFile(entry.path))}
                onDoubleClick={() => (entry.type === "directory" ? undefined : props.onPin(entry.path))}
                className={cn(
                  "w-full justify-start font-normal aria-current:bg-secondary",
                  entry.type === "directory" ? "text-foreground" : "text-muted-foreground aria-current:text-foreground",
                )}
              >
                {entry.type === "directory" ? (
                  <IconFolder data-icon="inline-start" />
                ) : (
                  <IconFile data-icon="inline-start" />
                )}
                <span className="min-w-0 truncate">{nameOf(entry.path)}</span>
              </Button>
            </li>
          ))}
          {listed.result.value.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">This folder is empty</li>
          ) : null}
        </ul>
      ) : (
        <WorkspacePending
          result={listed.result}
          icon={<IconFiles />}
          title="Could not list the files"
          onRetry={listed.refresh}
        />
      )}
    </>
  )
}

function Crumbs(props: { path: string; onFolder: (folder: string) => void }) {
  const parts = props.path.split("/")
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap gap-1 font-mono text-xs sm:gap-1">
        {parts.map((part, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- a segment's position in the path is its identity
          <BreadcrumbItem key={index} className="min-w-0 gap-1">
            {index === parts.length - 1 ? (
              <BreadcrumbPage className="truncate">{part}</BreadcrumbPage>
            ) : (
              <>
                <BreadcrumbLink
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto px-1 py-0.5 font-mono text-xs font-normal"
                      onClick={() => props.onFolder(`${parts.slice(0, index + 1).join("/")}/`)}
                    />
                  }
                >
                  {part}
                </BreadcrumbLink>
                <BreadcrumbSeparator />
              </>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function Unsupported(props: { file: SessionCatalog.FileContent }) {
  if (props.file.mime.startsWith("image/") && !props.file.truncated && props.file.encoding === "base64")
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto overscroll-contain p-4">
        <img
          src={`data:${props.file.mime};base64,${props.file.content}`}
          alt={nameOf(props.file.path)}
          className="max-w-full rounded-md border bg-muted object-contain"
        />
      </div>
    )
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
          <IconFile />
        </EmptyMedia>
        <EmptyTitle>No preview</EmptyTitle>
        <EmptyDescription>This file is not text ({props.file.mime}).</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function OpenIn(props: { file: SessionCatalog.FileContent; onMention: ((path: string) => void) | undefined }) {
  const write = Platform.usePlatform().writeClipboardText
  const copy = (text: string, done: string) =>
    void write?.(text).then(
      () => toast.success(done),
      (error: unknown) => toast.error("Could not copy", { description: errorMessage(error) }),
    )
  const download = () => {
    const bytes =
      props.file.encoding === "utf8"
        ? new TextEncoder().encode(props.file.content)
        : Uint8Array.from(atob(props.file.content), (char) => char.charCodeAt(0))
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([bytes], { type: props.file.mime }))
    link.download = nameOf(props.file.path)
    link.click()
    URL.revokeObjectURL(link.href)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Open in" />}
      >
        <IconDots />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!write} onClick={() => copy(props.file.path, "Path copied")}>
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!write || props.file.encoding !== "utf8"}
            onClick={() => copy(props.file.content, "Contents copied")}
          >
            Copy contents
          </DropdownMenuItem>
          <DropdownMenuItem disabled={props.file.truncated} onClick={download}>
            Download
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.onMention} onClick={() => props.onMention?.(props.file.path)}>
            Mention in prompt
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OpenFile(props: {
  root: Session.ID
  tab: FileTabs.Tab
  edits: number
  onFolder: (folder: string) => void
  onMention: ((path: string) => void) | undefined
}) {
  const platform = Platform.usePlatform()
  const theme = Theme.useTheme().preference
  const [wrap, setWrap] = useState(() => ChatPreferences.fileWrap.read(platform.storage))
  const read = ChatReact.useFile({ root: props.root, path: props.tab.path })
  useRefreshOn(props.edits, read.refresh)
  if (!AsyncResult.isSuccess(read.result)) {
    const failure = AsyncResult.isFailure(read.result) ? Cause.squash(read.result.cause) : undefined
    if (failure && errorStatus(failure) === 404)
      return (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
              <IconFile />
            </EmptyMedia>
            <EmptyTitle>No file at {props.tab.path}</EmptyTitle>
            <EmptyDescription>It may have been moved or deleted.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    return (
      <WorkspacePending
        result={read.result}
        icon={<IconFile />}
        title="Could not open the file"
        onRetry={read.refresh}
      />
    )
  }
  const file = read.result.value
  if (file.encoding !== "utf8")
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 px-3">
          <div className="min-w-0 flex-1">
            <Crumbs path={file.path} onFolder={props.onFolder} />
          </div>
          <OpenIn file={file} onMention={props.onMention} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
        </div>
        <Unsupported file={file} />
      </div>
    )
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
          <Spinner />
        </div>
      }
    >
      <FileView
        path={file.path}
        contents={file.content}
        highlight={file.size <= highlightLimit}
        theme={theme}
        wrap={wrap}
        onWrapChange={(next) => {
          setWrap(next)
          ChatPreferences.fileWrap.write(platform.storage, next)
        }}
        line={props.tab.line}
        breadcrumb={<Crumbs path={file.path} onFolder={props.onFolder} />}
        meta={file.truncated ? `${formatBytes(file.size)}, showing the start` : formatBytes(file.size)}
        actions={<OpenIn file={file} onMention={props.onMention} />}
      />
    </Suspense>
  )
}

function TabStrip(props: {
  state: FileTabs.State
  onSelect: (path: string) => void
  onPin: (path: string) => void
  onClose: (path: string) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-9 shrink-0 scrollbar-none overflow-x-auto overscroll-contain border-b px-1"
    >
      {props.state.tabs.map((tab) => (
        <span key={tab.path} className="group/file relative flex shrink-0">
          <Button
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={tab.path === props.state.active}
            title={tab.path}
            onClick={() => props.onSelect(tab.path)}
            onDoubleClick={() => props.onPin(tab.path)}
            onMouseDown={(event) => event.button === 1 && event.preventDefault()}
            onAuxClick={(event) => event.button === 1 && props.onClose(tab.path)}
            className={cn(
              "h-9 max-w-48 justify-start gap-1.5 rounded-none pr-7 pl-2.5 text-xs font-normal text-muted-foreground aria-selected:bg-secondary aria-selected:text-foreground",
              tab.preview && "italic",
            )}
          >
            <IconFile data-icon="inline-start" />
            <span className="truncate">{nameOf(tab.path)}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Close ${nameOf(tab.path)}`}
            onClick={() => props.onClose(tab.path)}
            className="absolute top-1/2 right-1 size-5 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within/file:opacity-100 group-hover/file:opacity-100 [&_svg:not([class*='size-'])]:size-3.5"
          >
            <IconX />
          </Button>
        </span>
      ))}
    </div>
  )
}

export function FilesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  onMention: ((path: string) => void) | undefined
}) {
  const [folder, setFolder] = useState("")
  const [files, setFiles] = useState(FileTabs.empty)
  const current = files.tabs.find((tab) => tab.path === files.active)
  const edits = editsOf(props.messages)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col border-r">
        <Folder
          root={props.root}
          folder={folder}
          selected={files.active}
          onFolder={setFolder}
          onFile={(path) => setFiles(FileTabs.open(files, path))}
          onPin={(path) => setFiles(FileTabs.pin(files, path))}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <>
            <TabStrip
              state={files}
              onSelect={(path) => setFiles({ ...files, active: path })}
              onPin={(path) => setFiles(FileTabs.pin(files, path))}
              onClose={(path) => setFiles(FileTabs.close(files, path))}
            />
            <OpenFile
              key={current.path}
              root={props.root}
              tab={current}
              edits={edits.find((edit) => edit.path === current.path)?.patches.length ?? 0}
              onFolder={setFolder}
              onMention={props.onMention}
            />
          </>
        ) : (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
                <IconFiles />
              </EmptyMedia>
              <EmptyTitle>Files</EmptyTitle>
              <EmptyDescription>Open a file from this chat’s environment to read it here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
