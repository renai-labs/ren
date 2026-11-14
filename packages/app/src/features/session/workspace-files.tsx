import { lazy, Suspense, useState } from "react"
import { ChatReact } from "@ren/chat/react"
import { FileTabs, Mentions } from "@ren/chat"
import type { FileSystem } from "@ren/schema/file-system"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Session } from "@ren/schema/session"
import { IconDots, IconFile, IconFiles, IconX } from "@tabler/icons-react"
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
import { FileIcon } from "@ren/ui/file-icon"
import { FileExplorer } from "@ren/ui/file-tree"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"
import { Theme } from "../../components/theme.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { errorStatus } from "../../lib/errors.js"
import { formatBytes } from "../../lib/format.js"
import { useRefreshOn } from "../../lib/use-refresh-on.js"
import { ancestorsOf, useWorkspaceFiles, type WorkspaceFiles } from "../../lib/use-workspace-files.js"
import { Platform } from "../../platform/platform.js"
import { editedPaths } from "./workspace-edits.js"
import { useCopy } from "../../lib/use-copy.js"
import { WorkspacePending } from "./workspace-state.js"
import type { PanelRequest } from "./workspace-panel.js"

const highlightLimit = 256 * 1024

const FileView = lazy(() => import("@ren/ui/file-view").then((module) => ({ default: module.FileView })))

const nameOf = (path: string) => path.replace(/\/$/u, "").split("/").at(-1) ?? path

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

function Unsupported(props: { file: FileSystem.Content }) {
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

function OpenIn(props: { file: FileSystem.Content; onMention: ((path: string) => void) | undefined }) {
  const copy = useCopy()
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
          <DropdownMenuItem disabled={!copy} onClick={() => copy?.(props.file.path, "Path copied")}>
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!copy || props.file.encoding !== "utf8"}
            onClick={() => copy?.(props.file.content, "Contents copied")}
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
            <FileIcon name={tab.path} data-icon="inline-start" />
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

function MenuItem(props: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" role="menuitem" className="justify-start font-normal" onClick={props.onClick}>
      {props.label}
    </Button>
  )
}

function Tree(props: {
  tree: WorkspaceFiles
  selected: string | undefined
  onOpen: (path: string) => void
  onPin: (path: string) => void
  onMention: ((path: string) => void) | undefined
  onTerminal: ((folder: string) => void) | undefined
}) {
  const tree = props.tree
  const root = tree.root
  const copy = useCopy()
  if (!root || !AsyncResult.isSuccess(root))
    return (
      <WorkspacePending
        result={root ?? AsyncResult.initial()}
        icon={<IconFiles />}
        title="Could not list the files"
        onRetry={() => tree.refreshFolder("")}
      />
    )
  return (
    <FileExplorer
      paths={tree.paths}
      loaded={tree.loaded}
      gitStatus={tree.gitStatus}
      selected={props.selected}
      dragType={Mentions.fileDragType}
      onSelect={props.onOpen}
      onPin={props.onPin}
      onExpand={tree.expand}
      onQuery={tree.setQuery}
      onRefresh={tree.refresh}
      notice={
        root.value.entries.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">This folder is empty</p>
        ) : null
      }
      // ast-grep-ignore: no-render-props -- the tree hands back the row that was right-clicked
      renderMenu={(item, close) => (
        <>
          {item.kind === "file" ? (
            <MenuItem
              label="Open"
              onClick={() => {
                close()
                props.onOpen(item.path)
              }}
            />
          ) : null}
          {copy ? (
            <MenuItem
              label="Copy path"
              onClick={() => {
                close()
                copy(item.path, "Path copied")
              }}
            />
          ) : null}
          {item.kind === "file" && props.onMention ? (
            <MenuItem
              label="Mention in prompt"
              onClick={() => {
                close()
                props.onMention?.(item.path)
              }}
            />
          ) : null}
          {props.onTerminal ? (
            <MenuItem
              label="Reveal in terminal"
              onClick={() => {
                close()
                props.onTerminal?.(item.kind === "directory" ? item.path : (ancestorsOf(item.path).at(-1) ?? ""))
              }}
            />
          ) : null}
        </>
      )}
    />
  )
}

export function FilesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  request: PanelRequest | undefined
  onMention: ((path: string) => void) | undefined
  onTerminal: ((folder: string) => void) | undefined
}) {
  const edited = editedPaths(props.messages)
  const tree = useWorkspaceFiles(props.root, edited)
  const [files, setFiles] = useState(FileTabs.empty)
  const [handled, setHandled] = useState<string>()
  if (props.request?.kind === "files" && props.request.id !== handled) {
    const path = props.request.path.trim().replace(/^\/+/u, "")
    setHandled(props.request.id)
    if (path) tree.reveal(path)
    if (path && !path.endsWith("/"))
      setFiles(FileTabs.open(files, path, props.request.line ? { line: props.request.line } : {}))
  }
  const current = files.tabs.find((tab) => tab.path === files.active)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-76 shrink-0 flex-col overflow-hidden border-r">
        <Tree
          tree={tree}
          selected={files.active}
          onOpen={(path) => setFiles(FileTabs.open(files, path))}
          onPin={(path) => setFiles(FileTabs.open(files, path, { pin: true }))}
          onMention={props.onMention}
          onTerminal={props.onTerminal}
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
              edits={edited.filter((path) => path === current.path).length}
              onFolder={tree.reveal}
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
