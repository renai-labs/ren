import { useState } from "react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconDeviceDesktop,
  IconFileDiff,
  IconFiles,
  IconLayoutSidebarRight,
  IconPlus,
  IconTerminal2,
  IconTimeline,
  IconWorld,
  IconX,
  type Icon,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { FileIcon } from "@ren/ui/file-icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { FileName } from "@ren/util/file-name"
import { cn } from "cn"
import { revealIn } from "../../lib/use-workspace-files.js"
import { ChangesTab } from "./workspace-changes.js"
import { ActivityTab } from "./workspace-activity.js"
import { FilesTab } from "./workspace-files.js"
import { WorkspaceProject } from "./workspace-project.js"
import type { Expansion } from "../../lib/use-workspace-files.js"
import { BrowserTab, ComputerTab } from "./workspace-streams.js"
import { TerminalTab } from "./workspace-terminal.js"

type Kind = "computer" | "browser" | "files" | "changes" | "activity" | "terminal"

const kinds: ReadonlyArray<{ kind: Kind; label: string; description: string; icon: Icon; many?: boolean }> = [
  { kind: "computer", label: "Computer", description: "Watch and control Ren’s computer", icon: IconDeviceDesktop },
  { kind: "browser", label: "Browser", description: "See the pages Ren opens", icon: IconWorld },
  { kind: "files", label: "Files", description: "Browse files in this workspace", icon: IconFiles },
  { kind: "changes", label: "Changes", description: "See what changed in this workspace", icon: IconFileDiff },
  { kind: "activity", label: "Activity", description: "See every step Ren took in this chat", icon: IconTimeline },
  {
    kind: "terminal",
    label: "Terminal",
    description: "Run commands in this chat’s environment",
    icon: IconTerminal2,
    many: true,
  },
]

const byKind = new Map(kinds.map((each) => [each.kind, each]))

type DriveTarget = { readonly spaceId: string | undefined; readonly file: SessionMessage.DriveFile }

export type PanelTarget =
  | { readonly kind: "terminal"; readonly folder?: string }
  | {
      readonly kind: "files"
      readonly path: string
      readonly line?: number | undefined
      readonly drive?: DriveTarget | undefined
    }
  | { readonly kind: "changes"; readonly path: string }
  | { readonly kind: "activity"; readonly turn?: string }

export type PanelRequest = PanelTarget & { readonly id: string }

export interface FileTarget {
  readonly path: string
  readonly preview: boolean
  readonly line?: number | undefined
  readonly drive?: DriveTarget | undefined
}

interface OpenTab {
  readonly id: string
  readonly kind: Kind
  readonly label: string
  readonly request?: PanelRequest
  readonly file?: FileTarget
}

const labelOf = (tab: OpenTab) => {
  if (!tab.file) return tab.label
  return tab.file.drive ? tab.file.drive.file.name : FileName.base(tab.file.path)
}

// oxlint-disable-next-line ren/no-comments -- A file a chat showed from the space's drive opens as its own tab, read from the drive, so it opens while the computer is off too.
const driveKey = (file: SessionMessage.DriveFile) => `drive:${file.path}`

const reusable = (
  tabs: ReadonlyArray<OpenTab>,
  current: OpenTab | undefined,
  kind: Kind,
  request: PanelRequest | undefined,
) => {
  if (!request && byKind.get(kind)?.many) return
  return current?.kind === kind ? current : tabs.find((tab) => tab.kind === kind)
}

const openTab = (
  tabs: ReadonlyArray<OpenTab>,
  current: OpenTab | undefined,
  kind: Kind,
  request: PanelRequest | undefined,
) => {
  const existing = reusable(tabs, current, kind, request)
  if (existing)
    return {
      tabs: tabs.map((tab) => (tab.id === existing.id && request ? { ...tab, request } : tab)),
      active: existing.id,
    }
  const meta = byKind.get(kind)
  const count = tabs.filter((tab) => tab.kind === kind).length
  const tab = {
    id: crypto.randomUUID(),
    kind,
    label: count > 0 ? `${meta?.label} ${count + 1}` : (meta?.label ?? kind),
    ...(request && { request }),
  }
  return { tabs: [...tabs, tab], active: tab.id }
}

function AddMenu(props: { onPick: (kind: Kind) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label="Open a tab" />
        }
      >
        <IconPlus />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandEmpty>Nothing found</CommandEmpty>
            <CommandGroup>
              {kinds.map((each) => (
                <CommandItem
                  key={each.kind}
                  value={each.label}
                  className="data-selected:*:[svg]:text-muted-foreground"
                  onSelect={() => {
                    setOpen(false)
                    props.onPick(each.kind)
                  }}
                >
                  <each.icon className="text-muted-foreground" />
                  {each.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Launcher(props: { onPick: (kind: Kind) => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <ul className="flex w-full max-w-80 flex-col">
        {kinds.map((each) => (
          <li key={each.kind}>
            <Button
              variant="ghost"
              aria-label={`${each.label}: ${each.description}`}
              onClick={() => props.onPick(each.kind)}
              className="h-auto w-full items-start justify-start gap-3 px-3 py-2.5 text-left font-normal whitespace-normal active:not-aria-[haspopup]:scale-[0.99] motion-reduce:active:not-aria-[haspopup]:scale-100"
            >
              <each.icon className="mt-0.5 text-muted-foreground" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{each.label}</span>
                <span className="text-xs text-muted-foreground">{each.description}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TabBody(props: {
  tab: OpenTab
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  projects: WorkspaceProject.Projects
  expansion: Expansion
  onOpenFile: (path: string, options: { readonly pin: boolean }) => void
  onChanges: () => void
  onClose: () => void
  onMention: ((path: string) => void) | undefined
  onTerminal: (folder: string) => void
  running: boolean
}) {
  const request = props.tab.request
  switch (props.tab.kind) {
    case "changes":
      return <ChangesTab root={props.root} messages={props.messages} request={request} projects={props.projects} />
    case "activity":
      return (
        <ActivityTab
          root={props.root}
          messages={props.messages}
          request={request?.kind === "activity" ? request : undefined}
          running={props.running}
        />
      )
    case "computer":
      return <ComputerTab />
    case "browser":
      return <BrowserTab />
    case "files":
      return (
        <FilesTab
          root={props.root}
          messages={props.messages}
          file={props.tab.file}
          projects={props.projects}
          expansion={props.expansion}
          onOpen={props.onOpenFile}
          onChanges={props.onChanges}
          onClose={props.onClose}
          onMention={props.onMention}
          onTerminal={props.onTerminal}
        />
      )
    case "terminal":
      return (
        <TerminalTab
          root={props.root}
          focus={request?.id}
          folder={request?.kind === "terminal" ? request.folder : undefined}
        />
      )
  }
}

export function WorkspacePanel(props: {
  root: Session.ID
  request: PanelRequest | undefined
  messages: ReadonlyArray<SessionMessage.Info>
  maximized: boolean
  onMaximize: (maximized: boolean) => void
  onClose: () => void
  onMention: ((path: string) => void) | undefined
  running: boolean
}) {
  const [tabs, setTabs] = useState<ReadonlyArray<OpenTab>>([])
  const [active, setActive] = useState<string>()
  const current = tabs.find((tab) => tab.id === active) ?? tabs.at(-1)
  const [handled, setHandled] = useState<string>()
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([])
  const projects = WorkspaceProject.useProjects(props.root, props.messages)
  const pick = (kind: Kind, request?: PanelRequest) => {
    const next = openTab(
      tabs,
      current,
      kind,
      request ?? (kind === "activity" ? { kind: "activity", id: crypto.randomUUID() } : undefined),
    )
    setTabs(next.tabs)
    setActive(next.active)
  }
  const openFile = (
    path: string,
    options: { readonly pin: boolean; readonly line?: number; readonly drive?: DriveTarget },
  ) => {
    const file: FileTarget = {
      path,
      preview: !options.pin,
      ...(options.line && { line: options.line }),
      ...(options.drive && { drive: options.drive }),
    }
    const same = tabs.find((tab) => tab.file?.path === path)
    const reuse =
      same ??
      (current?.kind === "files" && (!current.file || current.file.preview)
        ? current
        : tabs.find((tab) => tab.kind === "files" && tab.file?.preview))
    if (reuse) {
      const kept = same ? { ...file, preview: same.file?.preview === true && !options.pin } : file
      setTabs(tabs.map((tab) => (tab.id === reuse.id ? { ...tab, file: kept } : tab)))
      setActive(reuse.id)
      return
    }
    const tab: OpenTab = { id: crypto.randomUUID(), kind: "files", label: "Files", file }
    setTabs([...tabs, tab])
    setActive(tab.id)
  }
  const openRequest = (request: PanelRequest) => {
    if (request.kind !== "files") return pick(request.kind, request)
    if (request.drive) return openFile(driveKey(request.drive.file), { pin: true, drive: request.drive })
    const path = request.path.trim().replace(/^\/+/u, "")
    if (path) setExpanded((previous) => revealIn(previous, path))
    if (path) projects.reveal(path)
    if (!path || path.endsWith("/")) return pick("files")
    return openFile(path, { pin: false, ...(request.line && { line: request.line }) })
  }
  if (props.request && props.request.id !== handled) {
    setHandled(props.request.id)
    openRequest(props.request)
  }
  const close = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const next = tabs.filter((tab) => tab.id !== id)
    setTabs(next)
    if (current?.id === id) setActive(next[Math.min(index, next.length - 1)]?.id)
  }
  return (
    <aside aria-label="Workspace" className="flex size-full min-w-0 flex-col border-l">
      <Tabs
        value={current?.id ?? ""}
        onValueChange={(value: string) => setActive(value)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
          <TabsList className="h-7 min-w-0 shrink scrollbar-none justify-start gap-0.5 overflow-x-auto overscroll-contain bg-transparent p-0">
            {tabs.map((tab) => {
              const TabIcon = byKind.get(tab.kind)?.icon ?? IconFiles
              const label = labelOf(tab)
              return (
                <span key={tab.id} className="group/tab relative flex shrink-0">
                  <TabsTrigger
                    value={tab.id}
                    title={tab.file?.path}
                    onDoubleClick={() => {
                      if (tab.file?.preview)
                        openFile(tab.file.path, { pin: true, ...(tab.file.drive && { drive: tab.file.drive }) })
                    }}
                    onAuxClick={(event) => event.button === 1 && close(tab.id)}
                    className={cn(
                      "h-7 max-w-48 flex-none gap-1.5 rounded-md pr-7 pl-2 text-xs font-normal text-muted-foreground data-active:bg-secondary data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-secondary [&_svg]:text-muted-foreground",
                      tab.file?.preview && "italic",
                    )}
                  >
                    {tab.file ? <FileIcon name={label} /> : <TabIcon />}
                    <span className="truncate">{label}</span>
                  </TabsTrigger>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Close ${label}`}
                    onClick={() => close(tab.id)}
                    className="absolute top-1/2 right-1 size-5 -translate-y-1/2 rounded-sm text-muted-foreground opacity-0 transition-[color,background-color,opacity] group-hover/tab:opacity-100 group-has-data-active/tab:opacity-100 focus-visible:opacity-100 [&_svg:not([class*='size-'])]:size-3.5"
                  >
                    <IconX />
                  </Button>
                </span>
              )
            })}
          </TabsList>
          <AddMenu onPick={pick} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0 text-muted-foreground"
            aria-label={props.maximized ? "Restore panel" : "Maximize panel"}
            onClick={() => props.onMaximize(!props.maximized)}
          >
            {props.maximized ? <IconArrowsDiagonalMinimize2 /> : <IconArrowsDiagonal />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label="Close panel"
            onClick={props.onClose}
          >
            <IconLayoutSidebarRight stroke={2.25} />
          </Button>
        </div>
        {tabs.length === 0 ? <Launcher onPick={pick} /> : null}
        {/* oxlint-disable-next-line ren/no-comments -- Every file tab shares one Files view, so switching files keeps the tree, its scroll and its open folders. */}
        {[...tabs.filter((tab) => tab.kind !== "files"), ...(current?.kind === "files" ? [current] : [])].map((tab) => (
          <TabsContent key={tab.kind === "files" ? "files" : tab.id} value={tab.id} className="flex min-h-0 flex-col">
            <TabBody
              tab={tab}
              root={props.root}
              messages={props.messages}
              projects={projects}
              expansion={{ expanded, setExpanded }}
              onOpenFile={openFile}
              onChanges={() => pick("changes")}
              onClose={() => close(tab.id)}
              onMention={props.onMention}
              running={props.running}
              onTerminal={(folder) => pick("terminal", { kind: "terminal", folder, id: crypto.randomUUID() })}
            />
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  )
}
