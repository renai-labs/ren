import { useEffect, useRef, useState } from "react"
import { Link, useLocation } from "@tanstack/react-router"
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconBuilding,
  IconKey,
  IconSearch,
  IconServer,
  IconUsers,
} from "@tabler/icons-react"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export const settingsSections = [
  {
    label: "Personal",
    items: [
      {
        id: "preferences",
        to: "/settings/preferences",
        label: "Preferences",
        icon: IconAdjustmentsHorizontal,
      },
      { id: "credentials", to: "/settings/credentials", label: "Credentials", icon: IconKey },
    ],
  },
  {
    label: "Organization",
    items: [
      { id: "general", to: "/settings/general", label: "General", icon: IconBuilding },
      { id: "members", to: "/settings/members", label: "Members", icon: IconUsers },
      { id: "providers", to: "/settings/providers", label: "Providers", icon: IconServer },
    ],
  },
] as const

export function SettingsSidebar() {
  const section = useLocation({ select: (location) => location.pathname.split("/").at(2) })
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target
      const typing = target instanceof HTMLElement && target.closest("input, textarea, [contenteditable=true]")
      if (event.key !== "/" || typing) return
      event.preventDefault()
      search.current?.focus()
    }
    window.addEventListener("keydown", focus)
    return () => window.removeEventListener("keydown", focus)
  }, [])
  const needle = query.trim().toLowerCase()
  const sections = settingsSections
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => !needle || item.label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0)
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="gap-1 px-0 pt-0">
        <div className="mb-1 flex h-9">
          <SidebarTrigger />
        </div>
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton className="h-9" render={<Link to="/" />}>
              <IconArrowLeft />
              <span>Back to app</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="relative">
          <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            aria-label="Search settings"
            placeholder="Search settings…"
            className="border-transparent bg-muted pr-8 pl-9 dark:bg-muted"
          />
          <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((group) => (
          <SidebarGroup key={group.label} className="px-0 pb-4">
            <SidebarGroupLabel className="mb-1 text-sm text-sidebar-foreground">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      className="h-9"
                      isActive={section === item.id}
                      render={<Link to={item.to} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
