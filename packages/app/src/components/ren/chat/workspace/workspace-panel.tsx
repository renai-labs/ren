import { useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconBrowser,
  IconClipboardList,
  IconCode,
  IconDeviceDesktop,
  IconFileDiff,
  IconLayoutSidebarRightCollapse,
  IconPlus,
  IconTerminal2,
  IconX,
  type Icon,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChangesTab } from "@/components/ren/chat/workspace/changes"
import { ProgressTab } from "@/components/ren/chat/workspace/progress"
import { BrowserTab, ComputerTab, FilesTab, TerminalTab } from "@/components/ren/chat/workspace/streams"

type Kind = "computer" | "browser" | "files" | "changes" | "progress" | "terminal"

const kinds: ReadonlyArray<{ kind: Kind; label: string; description: string; icon: Icon; many?: boolean }> = [
  { kind: "computer", label: "Computer", description: "Watch and control Ren’s computer", icon: IconDeviceDesktop },
  { kind: "browser", label: "Browser", description: "See the pages Ren opens", icon: IconBrowser },
  { kind: "files", label: "Files", description: "Browse files in this workspace", icon: IconCode },
  { kind: "changes", label: "Changes", description: "See Ren’s file edits", icon: IconFileDiff },
  { kind: "progress", label: "Progress", description: "Understand Ren’s history and actions", icon: IconClipboardList },
  {
    kind: "terminal",
    label: "Terminal",
    description: "Open a terminal that belongs to this chat",
    icon: IconTerminal2,
    many: true,
  },
]

const byKind = new Map(kinds.map((each) => [each.kind, each]))

interface OpenTab {
  readonly id: string
  readonly kind: Kind
  readonly label: string
}

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
                  onSelect={() => {
                    setOpen(false)
                    props.onPick(each.kind)
                  }}
                >
                  <each.icon />
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
            <button
              type="button"
              aria-label={`${each.label}: ${each.description}`}
              onClick={() => props.onPick(each.kind)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ease-out outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:active:scale-100"
            >
              <each.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{each.label}</span>
                <span className="text-xs text-muted-foreground">{each.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WorkspacePanel(props: {
  messages: ReadonlyArray<SessionMessage.Info>
  maximized: boolean
  onMaximize: (maximized: boolean) => void
  onClose: () => void
}) {
  const [tabs, setTabs] = useState<ReadonlyArray<OpenTab>>([])
  const [active, setActive] = useState<string>()
  const current = tabs.find((tab) => tab.id === active) ?? tabs.at(-1)
  const pick = (kind: Kind) => {
    const meta = byKind.get(kind)
    const existing = meta?.many ? undefined : tabs.find((tab) => tab.kind === kind)
    if (existing) {
      setActive(existing.id)
      return
    }
    const count = tabs.filter((tab) => tab.kind === kind).length
    const tab = {
      id: crypto.randomUUID(),
      kind,
      label: count > 0 ? `${meta?.label} ${count + 1}` : (meta?.label ?? kind),
    }
    setTabs([...tabs, tab])
    setActive(tab.id)
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
        <div className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2">
          <TabsList className="h-8 min-w-0 shrink scrollbar-none justify-start gap-0.5 overflow-x-auto overscroll-contain bg-transparent p-0">
            {tabs.map((tab) => {
              const TabIcon = byKind.get(tab.kind)?.icon ?? IconCode
              return (
                <span key={tab.id} className="group/tab relative flex shrink-0">
                  <TabsTrigger
                    value={tab.id}
                    className="h-8 flex-none gap-1.5 pr-7 pl-2.5 font-normal text-muted-foreground data-active:bg-secondary data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-secondary"
                  >
                    <TabIcon />
                    {tab.label}
                  </TabsTrigger>
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    onClick={() => close(tab.id)}
                    className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/tab:opacity-100 group-has-data-active/tab:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  >
                    <IconX className="size-3.5" />
                  </button>
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
            {tab.kind === "changes" ? <ChangesTab messages={props.messages} /> : null}
            {tab.kind === "progress" ? <ProgressTab messages={props.messages} /> : null}
            {tab.kind === "computer" ? <ComputerTab /> : null}
            {tab.kind === "browser" ? <BrowserTab /> : null}
            {tab.kind === "files" ? <FilesTab /> : null}
            {tab.kind === "terminal" ? <TerminalTab /> : null}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  )
}
