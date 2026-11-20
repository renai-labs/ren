import {
  createContext,
  Fragment,
  lazy,
  Suspense,
  use,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { FileTabs, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { FileSystem } from "@ren/schema/file-system"
import type { Session } from "@ren/schema/session"
import {
  IconDots,
  IconFile,
  IconFileDiff,
  IconFiles,
  IconFolder,
  IconLayoutSidebar,
  IconMarkdown,
} from "@tabler/icons-react"
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { FileIcon } from "@ren/ui/file-icon"
import { FileExplorer } from "@ren/ui/file-tree"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { ResizeHandle } from "@ren/ui/resize-handle"
import { Spinner } from "@ren/ui/spinner"
import { Toggle } from "@ren/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { FileName } from "@ren/util/file-name"
import { cn } from "cn"
import { ChatPreferences } from "../lib/chat-preferences.js"
import { Preference } from "../lib/preference.js"
import { errorStatus } from "../lib/errors.js"
import { formatBytes } from "../lib/format.js"
import { useCopy } from "../lib/use-copy.js"
import { ancestorsOf } from "../lib/use-workspace-files.js"
import { Platform } from "../platform/platform.js"
import { Markdown } from "./markdown.js"
import { Theme } from "./theme.js"
import { WorkspacePending } from "./workspace-pending.js"

export interface FileTree {
  readonly base: string
  readonly root: AsyncResult.AsyncResult<{ readonly entries: ReadonlyArray<unknown> }, unknown> | undefined
  readonly paths: ReadonlyArray<string>
  readonly opened: ReadonlyArray<string>
  readonly gitStatus: ComponentProps<typeof FileExplorer>["gitStatus"]
  readonly setQuery: (query: string) => void
  readonly prefetch: (path: string) => void
  readonly expand: (path: string) => void
  readonly collapse: (path: string) => void
  readonly reveal: (path: string) => void
  readonly refreshFolder: (path: string) => void
  readonly refresh: () => void
}

export interface FileRead {
  readonly result: AsyncResult.AsyncResult<FileSystem.Content, unknown>
  readonly refresh: () => void
}

const loadFileView = () => import("@ren/ui/file-view")

const FileView = lazy(() => loadFileView().then((module) => ({ default: module.FileView })))

export interface Browse {
  readonly root: Session.ID
  readonly onOpen: (path: string) => void
}

const siblingLimit = 200

const folderOf = (path: string) => path.slice(0, path.slice(0, -1).lastIndexOf("/") + 1)

function Siblings(props: { browse: Browse; path: string; onFolder: (folder: string) => void; close: () => void }) {
  const folder = folderOf(props.path)
  const listed = ChatReact.useFolder({ root: props.browse.root, path: folder })
  if (!AsyncResult.isSuccess(listed.result))
    return (
      <div className="flex justify-center p-2 text-muted-foreground">
        {AsyncResult.isFailure(listed.result) ? (
          <span className="text-xs">Could not list {folder || "the folder"}</span>
        ) : (
          <Spinner />
        )}
      </div>
    )
  const entries = listed.result.value.entries
    .filter((entry) => FileName.base(entry.path.replace(/\/$/u, "")) !== ".git")
    .map((entry) => ({
      path: entry.type === "directory" && !entry.path.endsWith("/") ? `${entry.path}/` : entry.path,
      folder: entry.type === "directory",
    }))
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="truncate">{folder || "Chat folder"}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={props.path}
        onValueChange={(value: string) => {
          props.close()
          if (value.endsWith("/")) props.onFolder(value)
          else props.browse.onOpen(value)
        }}
      >
        {entries.slice(0, siblingLimit).map((entry) => (
          <DropdownMenuRadioItem key={entry.path} value={entry.path}>
            {entry.folder ? <IconFolder /> : <FileIcon name={FileName.base(entry.path)} />}
            <span className="truncate">{FileName.base(entry.path.replace(/\/$/u, ""))}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {entries.length > siblingLimit ? (
        <DropdownMenuLabel className="font-normal">
          {entries.length - siblingLimit} more in the file tree
        </DropdownMenuLabel>
      ) : null}
    </DropdownMenuGroup>
  )
}

function Crumb(props: {
  label: string
  path: string
  current: boolean
  browse: Browse | undefined
  onFolder: (folder: string) => void
}) {
  const [open, setOpen] = useState(false)
  const look = "h-6 min-w-0 shrink px-1.5 text-xs font-normal"
  if (props.browse)
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-current={props.current ? "page" : undefined}
              title={props.label}
              className={cn(look, props.current ? "text-foreground" : "text-muted-foreground")}
            />
          }
        >
          <span className="truncate">{props.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64">
          <Siblings browse={props.browse} path={props.path} onFolder={props.onFolder} close={() => setOpen(false)} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  if (props.current) return <BreadcrumbPage className="truncate">{props.label}</BreadcrumbPage>
  return (
    <BreadcrumbLink
      render={
        <Button
          variant="ghost"
          size="sm"
          title={props.label}
          className={look}
          onClick={() => props.onFolder(props.path)}
        />
      }
    >
      <span className="truncate">{props.label}</span>
    </BreadcrumbLink>
  )
}

function Crumbs(props: { path: string; browse: Browse | undefined; onFolder: (folder: string) => void }) {
  const parts = props.path.split("/")
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap gap-0.5 text-xs sm:gap-0.5">
        {parts.map((part, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- a segment's position in the path is its identity
          <Fragment key={index}>
            <BreadcrumbItem
              className={cn("min-w-0 gap-1", index < parts.length - 1 && "min-w-8 shrink-10 @max-sm/file-pane:hidden")}
            >
              <Crumb
                label={part}
                path={index === parts.length - 1 ? props.path : `${parts.slice(0, index + 1).join("/")}/`}
                current={index === parts.length - 1}
                browse={props.browse}
                onFolder={props.onFolder}
              />
            </BreadcrumbItem>
            {index === parts.length - 1 ? null : <BreadcrumbSeparator className="@max-sm/file-pane:hidden" />}
          </Fragment>
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
          alt={FileName.base(props.file.path)}
          className="max-w-full rounded-md border bg-muted object-contain"
        />
      </div>
    )
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia className="[&_svg]:size-6">
          <FileIcon name={FileName.base(props.file.path)} mime={props.file.mime} />
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
    link.download = FileName.base(props.file.path)
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
          <DropdownMenuLabel className="font-normal tabular-nums">{formatBytes(props.file.size)}</DropdownMenuLabel>
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

const TreeToggle = createContext<{ readonly shown: boolean; readonly onShownChange: (shown: boolean) => void } | null>(
  null,
)

function TreeButton(props: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            className="text-muted-foreground"
            onClick={props.onClick}
          />
        }
      >
        {props.icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  )
}

function ShowTree() {
  const toggle = use(TreeToggle)
  if (!toggle || toggle.shown) return null
  return (
    <TreeButton
      label="Show file tree"
      icon={<IconLayoutSidebar stroke={2.25} />}
      onClick={() => toggle.onShownChange(true)}
    />
  )
}

function FileLoading(props: { path: string; browse: Browse | undefined; onFolder: (folder: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <ShowTree />
          <Crumbs path={props.path} browse={props.browse} onFolder={props.onFolder} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 animate-in items-center justify-center text-muted-foreground delay-300 duration-200 fade-in-0 fill-mode-backwards motion-reduce:animate-none">
        <Spinner />
      </div>
    </div>
  )
}

const truncation = (file: FileSystem.Content) =>
  file.truncated ? `Showing the start of ${formatBytes(file.size)}` : null

export function OpenFile(props: {
  read: FileRead
  tab: FileTabs.Tab
  browse?: Browse | undefined
  onFolder: (folder: string) => void
  onMention: ((path: string) => void) | undefined
}) {
  const read = props.read
  if (!AsyncResult.isSuccess(read.result)) {
    const failure = AsyncResult.isFailure(read.result) ? Cause.squash(read.result.cause) : undefined
    if (failure && errorStatus(failure) === 404)
      return (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia className="[&_svg]:size-6">
              <FileIcon name={FileName.base(props.tab.path)} />
            </EmptyMedia>
            <EmptyTitle>No file at {props.tab.path}</EmptyTitle>
            <EmptyDescription>It may have been moved or deleted.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    if (!failure) return <FileLoading path={props.tab.path} browse={props.browse} onFolder={props.onFolder} />
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
          <ShowTree />
          <div className="min-w-0 flex-1">
            <Crumbs path={file.path} browse={props.browse} onFolder={props.onFolder} />
          </div>
          <OpenIn file={file} onMention={props.onMention} />
        </div>
        <Unsupported file={file} />
      </div>
    )
  return (
    <TextFile
      key={file.path}
      file={file}
      line={props.tab.line}
      browse={props.browse}
      onFolder={props.onFolder}
      onMention={props.onMention}
    />
  )
}

const markdownFile = /\.(?:md|mdx|markdown|mdown|mkd)$/iu

function TextFile(props: {
  file: FileSystem.Content
  line: number | undefined
  browse: Browse | undefined
  onFolder: (folder: string) => void
  onMention: ((path: string) => void) | undefined
}) {
  const platform = Platform.usePlatform()
  const theme = Theme.useTheme().preference
  const [wrap, setWrap] = useState(() => ChatPreferences.fileWrap.read(platform.storage))
  const [rendered, setRendered] = useState(false)
  const file = props.file
  const breadcrumb = (
    <div className="flex min-w-0 items-center gap-1">
      <ShowTree />
      <Crumbs path={file.path} browse={props.browse} onFolder={props.onFolder} />
    </div>
  )
  const markdown = markdownFile.test(file.path)
  const toggle = markdown ? (
    <Toggle
      size="sm"
      aria-label="Show rendered Markdown"
      pressed={rendered}
      onPressedChange={setRendered}
      className="text-muted-foreground"
    >
      <IconMarkdown />
    </Toggle>
  ) : null
  if (markdown && rendered)
    return (
      <section aria-label="File viewer" className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 px-3">
          <div className="min-w-0 flex-1">{breadcrumb}</div>
          {toggle}
          <OpenIn file={file} onMention={props.onMention} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{truncation(file)}</span>
        </div>
        <div className="min-h-0 flex-1 scroll-fade-y overflow-y-auto overscroll-contain px-6 py-5">
          <Markdown className="mx-auto max-w-3xl text-sm/6">{file.content}</Markdown>
        </div>
      </section>
    )
  return (
    <Suspense fallback={<FileLoading path={file.path} browse={props.browse} onFolder={props.onFolder} />}>
      <FileView
        path={file.path}
        contents={file.content}
        theme={theme}
        wrap={wrap}
        onWrapChange={(next) => {
          setWrap(next)
          ChatPreferences.fileWrap.write(platform.storage, next)
        }}
        line={props.line}
        breadcrumb={breadcrumb}
        meta={truncation(file)}
        actions={
          <>
            {toggle}
            <OpenIn file={file} onMention={props.onMention} />
          </>
        }
      />
    </Suspense>
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
  tree: FileTree
  header: ReactNode
  tools: ReactNode
  actions: ReactNode
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
      key={tree.base}
      paths={tree.paths}
      opened={tree.opened}
      gitStatus={tree.gitStatus}
      selected={props.selected}
      dragType={Mentions.fileDragType}
      base={tree.base}
      onSelect={props.onOpen}
      onPin={props.onPin}
      onExpand={tree.expand}
      onCollapse={tree.collapse}
      onHover={tree.prefetch}
      onQuery={tree.setQuery}
      onRefresh={tree.refresh}
      header={props.header}
      tools={props.tools}
      actions={props.actions}
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
                copy(tree.base + item.path, "Path copied")
              }}
            />
          ) : null}
          {item.kind === "file" && props.onMention ? (
            <MenuItem
              label="Mention in prompt"
              onClick={() => {
                close()
                props.onMention?.(tree.base + item.path)
              }}
            />
          ) : null}
          {props.onTerminal ? (
            <MenuItem
              label="Reveal in terminal"
              onClick={() => {
                close()
                props.onTerminal?.(
                  tree.base + (item.kind === "directory" ? item.path : (ancestorsOf(item.path).at(-1) ?? "")),
                )
              }}
            />
          ) : null}
        </>
      )}
    />
  )
}

const treeMin = 160

const contentMin = 256

export function FileBrowser(props: {
  tree: FileTree
  header: ReactNode
  current: string | undefined
  open: boolean
  onOpen: (path: string, options: { readonly pin: boolean }) => void
  onChanges: () => void
  onMention: ((path: string) => void) | undefined
  onTerminal: ((folder: string) => void) | undefined
  empty: string
  children: ReactNode
}) {
  const base = props.tree.base
  const current = props.current
  const shown = Preference.usePreference(ChatPreferences.fileTree)
  const width = Preference.usePreference(ChatPreferences.fileTreeWidth)
  const setPreference = Preference.useSetPreference()
  const row = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const sizeTree = (node: HTMLDivElement | null, next: number) =>
    node?.style.setProperty("--file-tree-width", `clamp(${treeMin}px, ${next}px, calc(100% - ${contentMin}px))`)
  const toggle = { shown, onShownChange: (next: boolean) => setPreference(ChatPreferences.fileTree, next) }
  useEffect(() => {
    void loadFileView()
  }, [])
  return (
    <div className="flex min-h-0 flex-1 px-2 pb-4">
      <div ref={row} className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
        {shown || !props.open ? (
          <div
            ref={(node) => {
              pane.current = node
              sizeTree(node, width)
            }}
            className="relative flex w-(--file-tree-width) shrink-0 flex-col overflow-hidden border-r"
          >
            <Tree
              tree={props.tree}
              header={props.header}
              tools={<TreeButton label="Changes" icon={<IconFileDiff />} onClick={props.onChanges} />}
              actions={
                props.open ? (
                  <TreeButton
                    label="Hide file tree"
                    icon={<IconLayoutSidebar stroke={2.25} />}
                    onClick={() => toggle.onShownChange(false)}
                  />
                ) : null
              }
              selected={current?.startsWith(base) ? current.slice(base.length) : undefined}
              onOpen={(path) => props.onOpen(base + path, { pin: false })}
              onPin={(path) => props.onOpen(base + path, { pin: true })}
              onMention={props.onMention}
              onTerminal={props.onTerminal}
            />
            <ResizeHandle
              label="Resize file tree"
              side="right"
              width={width}
              min={treeMin}
              max={() => (row.current?.getBoundingClientRect().width ?? treeMin + contentMin) - contentMin}
              onResize={(next) => sizeTree(pane.current, next)}
              onCommit={(next) => setPreference(ChatPreferences.fileTreeWidth, next)}
              onReset={() => setPreference(ChatPreferences.fileTreeWidth, ChatPreferences.fileTreeWidth.fallback)}
            />
          </div>
        ) : null}
        <div className="@container/file-pane flex min-w-0 flex-1 flex-col">
          {props.open ? (
            <TreeToggle value={toggle}>{props.children}</TreeToggle>
          ) : (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
                  <IconFiles />
                </EmptyMedia>
                <EmptyTitle>Files</EmptyTitle>
                <EmptyDescription>{props.empty}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </div>
  )
}
