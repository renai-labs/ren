import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconBox,
  IconMessagesFilled,
  IconBuilding,
  IconKey,
  IconSearch,
  IconServer,
  IconUsers,
} from "@tabler/icons-react"
import { Kbd } from "@ren/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@ren/ui/sidebar"
import { Footer, Header, Section, sidebarRow } from "./sidebar-parts.js"
import { canAdministerOptions } from "../lib/auth.js"
import { RouterContext } from "../lib/router-context.js"
import { Keyboard } from "../platform/keyboard.js"

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
      { id: "general", to: "/settings/general", label: "General", icon: IconBuilding, admin: true },
      { id: "members", to: "/settings/members", label: "Members", icon: IconUsers, admin: true },
      { id: "environments", to: "/settings/environments", label: "Environments", icon: IconBox, admin: true },
      { id: "providers", to: "/settings/providers", label: "Providers", icon: IconServer },
      { id: "channels", to: "/settings/channels", label: "Channels", icon: IconMessagesFilled },
    ],
  },
] as const

function SettingsMenu(props: {
  items: ReadonlyArray<(typeof settingsSections)[number]["items"][number]>
  section: string | undefined
}) {
  return (
    <SidebarMenu className="gap-1">
      {props.items.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            className={sidebarRow}
            isActive={props.section === item.id}
            tooltip={item.label}
            render={<Link to={item.to} />}
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

export function SettingsSidebar(props: { onSearch: () => void }) {
  const { auth } = RouterContext.useRouterContext()
  const admin = useQuery(canAdministerOptions(auth)).data === true
  const section = useLocation({ select: (location) => location.pathname.split("/").at(2) })
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  Keyboard.useKeyDown((event) => {
    const target = event.target
    const typing = target instanceof HTMLElement && target.closest("input, textarea, [contenteditable=true]")
    if (event.key !== "/" || typing) return
    event.preventDefault()
    search.current?.focus()
  })
  const needle = query.trim().toLowerCase()
  const sections = settingsSections
    .map((group) => ({
      label: group.label,
      items: group.items.filter(
        (item) => (admin || !("admin" in item)) && (!needle || item.label.toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.items.length > 0)
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-0 p-0">
        <Header onSearch={props.onSearch} />
        <SidebarMenu className="gap-1 px-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton className={sidebarRow} tooltip="Back to app" render={<Link to="/" />}>
              <IconArrowLeft />
              <span>Back to app</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="relative mx-0.5 mt-2 group-data-[collapsible=icon]:hidden">
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
          <Section key={group.label} label={group.label} className="shrink-0">
            <SettingsMenu items={group.items} section={section} />
          </Section>
        ))}
      </SidebarContent>
      <Footer />
      <SidebarRail />
    </Sidebar>
  )
}
