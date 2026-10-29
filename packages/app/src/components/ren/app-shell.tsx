import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Outlet, useLocation } from "@tanstack/react-router"
import { useEffect } from "react"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/ren/app-sidebar"
import { NewTaskDialog, useNewTaskShortcut } from "@/components/ren/new-task-dialog"
import { SearchDialog } from "@/components/ren/search-dialog"
import { SettingsSidebar } from "@/components/ren/settings-sidebar"
import { SpaceNavSwitcher, SpaceSidebar } from "@/components/ren/space-sidebar"
import { useMe } from "@/hooks/use-me"
import { chatFor } from "@/lib/chat"
import { toggleSearch, useSpaceNav } from "@/stores/ui"

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

export function AppShell() {
  const me = useMe()
  const chat = chatFor(me.user.id)
  useSearchShortcut()
  useNewTaskShortcut()
  const spaceId = useLocation({ select: (location) => /^\/spaces\/([^/]+)/u.exec(location.pathname)?.[1] })
  const spaceSidebar = useSpaceNav() === "sidebar" && spaceId !== undefined
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <SidebarProvider>
          {spaceSidebar ? <SpaceSidebar spaceId={spaceId} /> : <AppSidebar />}
          <SidebarInset className={insetClass}>
            <div
              data-slot="page-scroll"
              className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            >
              <Outlet />
            </div>
          </SidebarInset>
          <SearchDialog />
          <NewTaskDialog />
          <SpaceNavSwitcher />
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
