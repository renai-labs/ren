import { useState } from "react"
import { getRouteApi } from "@tanstack/react-router"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconDeviceDesktop,
  IconFileDiff,
  IconFiles,
  IconLayoutSidebarRightCollapse,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { ChangesTab } from "./workspace-changes.js"
import { ProgressTab } from "./workspace-progress.js"
import { FilesTab } from "./workspace-files.js"
import { BrowserTab, ComputerTab } from "./workspace-streams.js"
import { TerminalTab } from "./workspace-terminal.js"

type Kind = "computer" | "browser" | "files" | "changes" | "progress" | "terminal"

const kinds: ReadonlyArray<{ kind: Kind; label: string; description: string; icon: Icon; many?: boolean }> = [
  { kind: "computer", label: "Computer", description: "Watch and control Ren’s computer", icon: IconDeviceDesktop },
  { kind: "browser", label: "Browser", description: "See the pages Ren opens", icon: IconWorld },
  { kind: "files", label: "Files", description: "Browse files in this workspace", icon: IconFiles },
  { kind: "changes", label: "Changes", description: "See what changed in this workspace", icon: IconFileDiff },
  { kind: "progress", label: "Progress", description: "Understand Ren’s history and actions", icon: IconTimeline },
  {
    kind: "terminal",
    label: "Terminal",
    description: "Run commands in this chat’s environment",
    icon: IconTerminal2,
    many: true,
  },
]

const byKind = new Map(kinds.map((each) => [each.kind, each]))

const names = new Map<string, Kind>(kinds.map((each) => [each.kind, each.kind]))

const route = getRouteApi("/_authed/_shell/sessions/$sessionId/")

const parseKinds = (panel: string | undefined) => (panel?.split(",") ?? []).flatMap((part) => names.get(part) ?? [])

const tabsOf = (open: ReadonlyArray<Kind>) =>
  open.map((kind, index) => {
    const count = open.slice(0, index).filter((other) => other === kind).length
    const label = byKind.get(kind)?.label ?? kind
    return { id: count > 0 ? `${kind}-${count + 1}` : kind, kind, label: count > 0 ? `${label} ${count + 1}` : label }
  })

function AddMenu(props: { onPick: (kind: Kind) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="Open a tab" />
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

export function WorkspacePanel(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  maximized: boolean
  onMaximize: (maximized: boolean) => void
  onClose: () => void
}) {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tabs = tabsOf(parseKinds(search.panel))
  const current =
    tabs.find((tab) => tab.id === search.tab) ??
    (search.file === undefined ? undefined : tabs.find((tab) => tab.kind === "files")) ??
    tabs.at(-1)
  const show = (next: ReadonlyArray<{ readonly id: string; readonly kind: Kind }>, active: string | undefined) =>
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        panel: next.length > 0 ? next.map((tab) => tab.kind).join(",") : undefined,
        tab: active,
        ...(next.some((tab) => tab.kind === "files") ? {} : { file: undefined, line: undefined }),
      }),
    })
  const pick = (kind: Kind) => {
    const existing = byKind.get(kind)?.many ? undefined : tabs.find((tab) => tab.kind === kind)
    if (existing) {
      show(tabs, existing.id)
      return
    }
    const next = tabsOf([...tabs.map((tab) => tab.kind), kind])
    show(next, next.at(-1)?.id)
  }
  const close = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const next = tabsOf(tabs.filter((tab) => tab.id !== id).map((tab) => tab.kind))
    show(next, current?.id === id ? next[Math.min(index, next.length - 1)]?.id : current?.id)
  }
  const line = search.line !== undefined && Number.isInteger(search.line) && search.line > 0 ? search.line : undefined
  return (
    <aside aria-label="Workspace" className="flex size-full min-w-0 flex-col border-l">
      <Tabs
        value={current?.id ?? ""}
        onValueChange={(value: string) => show(tabs, value)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2">
          <TabsList className="h-8 min-w-0 shrink scrollbar-none justify-start gap-0.5 overflow-x-auto overscroll-contain bg-transparent p-0">
            {tabs.map((tab) => {
              const TabIcon = byKind.get(tab.kind)?.icon ?? IconFiles
              return (
                <span key={tab.id} className="group/tab relative flex shrink-0">
                  <TabsTrigger
                    value={tab.id}
                    className="h-8 flex-none gap-1.5 pr-7 pl-2.5 font-normal text-muted-foreground data-active:bg-secondary data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-secondary [&_svg]:text-muted-foreground"
                  >
                    <TabIcon />
                    {tab.label}
                  </TabsTrigger>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Close ${tab.label}`}
                    onClick={() => close(tab.id)}
                    className="absolute top-1/2 right-1.5 size-5 -translate-y-1/2 rounded-sm text-muted-foreground opacity-0 transition-[color,background-color,opacity] group-hover/tab:opacity-100 group-has-data-active/tab:opacity-100 focus-visible:opacity-100 [&_svg:not([class*='size-'])]:size-3.5"
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
            size="icon"
            className="ml-auto shrink-0 text-muted-foreground"
            aria-label={props.maximized ? "Restore panel" : "Maximize panel"}
            onClick={() => props.onMaximize(!props.maximized)}
          >
            {props.maximized ? <IconArrowsDiagonalMinimize2 /> : <IconArrowsDiagonal />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="Close panel"
            onClick={props.onClose}
          >
            <IconLayoutSidebarRightCollapse />
          </Button>
        </div>
        {tabs.length === 0 ? <Launcher onPick={pick} /> : null}
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="flex min-h-0 flex-col">
            {tab.kind === "changes" ? <ChangesTab root={props.root} messages={props.messages} /> : null}
            {tab.kind === "progress" ? <ProgressTab messages={props.messages} /> : null}
            {tab.kind === "computer" ? <ComputerTab /> : null}
            {tab.kind === "browser" ? <BrowserTab /> : null}
            {tab.kind === "files" ? (
              <FilesTab
                root={props.root}
                file={search.file}
                line={line}
                onFile={(file) =>
                  void navigate({ replace: true, search: (previous) => ({ ...previous, file, line: undefined }) })
                }
              />
            ) : null}
            {tab.kind === "terminal" ? <TerminalTab root={props.root} /> : null}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  )
}
