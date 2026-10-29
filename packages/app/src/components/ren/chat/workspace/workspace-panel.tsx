import { useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconClipboardList,
  IconDeviceDesktop,
  IconFileDiff,
  IconLayoutSidebarRightCollapse,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChangesTab } from "@/components/ren/chat/workspace/changes"
import { ProgressTab } from "@/components/ren/chat/workspace/progress"
import { BrowserTab, ComputerTab, TerminalTab } from "@/components/ren/chat/workspace/streams"
import { cn } from "@/lib/utils"

const tabs = [
  { value: "changes", label: "Changes", icon: IconFileDiff },
  { value: "computer", label: "Computer", icon: IconDeviceDesktop },
  { value: "progress", label: "Progress", icon: IconClipboardList },
  { value: "browser", label: "Browser", icon: IconWorld },
  { value: "terminal", label: "Terminal", icon: IconTerminal2 },
] as const

export function WorkspacePanel(props: {
  messages: ReadonlyArray<SessionMessage.Info>
  maximized: boolean
  onMaximize: (maximized: boolean) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<string>("progress")
  return (
    <aside
      aria-label="Workspace"
      className={cn(
        "@container flex min-w-0 flex-col border-l",
        props.maximized ? "flex-1" : "w-[min(55%,56rem)] shrink-0",
      )}
    >
      <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="min-h-0 flex-1 gap-0">
        <div className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2">
          <TabsList className="h-8 min-w-0 shrink scrollbar-none justify-start gap-0.5 overflow-x-auto overscroll-contain bg-transparent p-0">
            {tabs.map((each) => (
              <TabsTrigger
                key={each.value}
                value={each.value}
                aria-label={each.label}
                title={each.label}
                className="h-8 flex-none gap-1.5 px-2.5 font-normal text-muted-foreground data-active:bg-secondary data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-secondary"
              >
                <each.icon />
                <span className="hidden @[46rem]:inline">{each.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
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
        <TabsContent value="changes" className="flex min-h-0 flex-col">
          <ChangesTab messages={props.messages} />
        </TabsContent>
        <TabsContent value="computer" className="flex min-h-0 flex-col">
          <ComputerTab />
        </TabsContent>
        <TabsContent value="progress" className="flex min-h-0 flex-col">
          <ProgressTab messages={props.messages} />
        </TabsContent>
        <TabsContent value="browser" className="flex min-h-0 flex-col">
          <BrowserTab />
        </TabsContent>
        <TabsContent value="terminal" className="flex min-h-0 flex-col">
          <TerminalTab />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
