import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Outlet } from "@tanstack/react-router"
import { Suspense, useState } from "react"
import { RouteSkeleton } from "./route-skeleton.js"
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { AppSidebar } from "./app-sidebar.js"
import { NewTaskDialog, useNewTaskShortcut } from "./new-task-dialog.js"
import { SearchDialog } from "./search-dialog.js"
import { SettingsSidebar } from "./settings-sidebar.js"
import { SpaceSidebar } from "./space-sidebar.js"
import { useMe } from "../lib/use-me.js"
import { chatFor } from "../lib/chat.js"
import { Routing } from "../lib/routing.js"
import { Keyboard } from "../platform/keyboard.js"
import { Platform } from "../platform/platform.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"

const insetClass = "h-svh overflow-hidden md:h-[calc(100svh-1rem)] md:shadow-none md:inset-ring md:inset-ring-border"

function useSearchShortcut(onToggle: () => void) {
  Keyboard.useKeyDown((event) => {
    if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey) return
    event.preventDefault()
    onToggle()
  })
}

function SidebarOpen() {
  const sidebar = useSidebar()
  if (!sidebar.isMobile) return null
  return (
    <Tooltip>
      <TooltipTrigger render={<SidebarTrigger className="absolute top-2 left-2 z-20 text-muted-foreground" />} />
      <TooltipContent side="right">Expand sidebar</TooltipContent>
    </Tooltip>
  )
}

function ShellSidebar(props: { path: string; onSearch: () => void }) {
  const spaceId = /^\/spaces\/([^/]+)/u.exec(props.path)?.[1]
  if (spaceId !== undefined) return <SpaceSidebar spaceId={spaceId} onSearch={props.onSearch} />
  if (/^\/settings(?:\/|$)/u.test(props.path)) return <SettingsSidebar onSearch={props.onSearch} />
  return <AppSidebar onSearch={props.onSearch} />
}

export function AppShell() {
  const platform = Platform.usePlatform()
  const me = useMe()
  const chat = chatFor(platform, me.user.id)
  const [searching, setSearching] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => SidebarPreferences.open.read(platform.storage))
  useSearchShortcut(() => setSearching((current) => !current))
  useNewTaskShortcut(() => setCreatingTask(true))
  const path = Routing.useRenderedPath()
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={(next) => {
            SidebarPreferences.open.write(platform.storage, next)
            setSidebarOpen(next)
          }}
        >
          <ShellSidebar path={path} onSearch={() => setSearching(true)} />
          <SidebarInset className={insetClass}>
            <SidebarOpen />
            <div
              data-slot="page-scroll"
              className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            >
              <Suspense fallback={<RouteSkeleton />}>
                <Outlet />
              </Suspense>
            </div>
          </SidebarInset>
          <SearchDialog open={searching} onOpenChange={setSearching} />
          <NewTaskDialog open={creatingTask} onOpenChange={setCreatingTask} />
        </SidebarProvider>
      </ChatReact.Provider>
    </RegistryContext>
  )
}
