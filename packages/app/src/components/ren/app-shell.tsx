import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Outlet, useLocation } from "@tanstack/react-router"
import { useEffect } from "react"
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/ren/app-sidebar"
import { NewTaskDialog, useNewTaskShortcut } from "@/components/ren/new-task-dialog"
import { SearchDialog } from "@/components/ren/search-dialog"
import { SettingsSidebar } from "@/components/ren/settings-sidebar"
import { SpaceSidebar } from "@/components/ren/space-sidebar"
import { useMe } from "@/hooks/use-me"
import { chatFor } from "@/lib/chat"
import { toggleSearch } from "@/stores/ui"

const insetClass = "h-svh overflow-hidden md:h-[calc(100svh-1rem)] md:shadow-none md:inset-ring md:inset-ring-border"

function useSearchShortcut() {
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey) return
      event.preventDefault()
      toggleSearch()
    }
    window.addEventListener("keydown", open)
    return () => window.removeEventListener("keydown", open)
  }, [])
}

function SidebarOpen() {
  const sidebar = useSidebar()
  if (!sidebar.isMobile && sidebar.state === "expanded") return null
  return <SidebarTrigger className="absolute top-2 left-2 z-20 text-muted-foreground" />
}

export function AppShell() {
  const me = useMe()
  const chat = chatFor(me.user.id)
  useSearchShortcut()
  useNewTaskShortcut()
  const spaceId = useLocation({ select: (location) => /^\/spaces\/([^/]+)/u.exec(location.pathname)?.[1] })
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <SidebarProvider>
          {spaceId === undefined ? <AppSidebar /> : <SpaceSidebar spaceId={spaceId} />}
          <SidebarInset className={insetClass}>
            <SidebarOpen />
            <div
              data-slot="page-scroll"
              className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            >
              <Outlet />
            </div>
          </SidebarInset>
          <SearchDialog />
          <NewTaskDialog />
        </SidebarProvider>
      </ChatReact.Provider>
    </RegistryContext>
  )
}

export function SettingsShell() {
  useSearchShortcut()
  return (
    <SidebarProvider>
      <SettingsSidebar />
      <SidebarInset className={insetClass}>
        <SidebarOpen />
        <div
          data-slot="page-scroll"
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        >
          <Outlet />
        </div>
      </SidebarInset>
      <SearchDialog />
    </SidebarProvider>
  )
}
