import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Kbd } from "@ren/ui/kbd"
import { Logotype } from "@ren/ui/logotype"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  useSidebar,
} from "@ren/ui/sidebar"
import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Pathname } from "@ren/util/pathname"
import { Viewport } from "../platform/viewport.js"
import { SidebarItem, SidebarToggle } from "./app-shell.js"

const pages: ReadonlyArray<{ to: "/spaces" | "/tasks" | "/schedules" | "/marketplace"; label: string; glyph: Glyph }> =
  [
    { to: "/spaces", label: "Spaces", glyph: "Cube" },
    { to: "/tasks", label: "Tasks", glyph: "Checklist" },
    { to: "/schedules", label: "Schedules", glyph: "Clock" },
    { to: "/marketplace", label: "Marketplace", glyph: "LayoutGrid" },
  ]

export function AppSidebar(props: { onSearch: () => void; chats: ReactNode; footer: ReactNode }) {
  const pathname = useRouterState({ select: (state) => Pathname.trimTrailingSlashes(state.location.pathname) })
  const sidebar = useSidebar()
  const dismiss = () => sidebar.setOpenMobile(false)
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- shadcn's Sidebar renders a div and passes these to it
    <Sidebar variant="inset" collapsible="icon" role="complementary" aria-label="Navigation">
      <SidebarHeader className="p-0">
        <div className="mb-2 flex h-7 items-center gap-2 pl-2 group-data-[collapsible=icon]:pl-0">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            aria-label="Ren home"
            onClick={dismiss}
            className="flex flex-1 items-center gap-2 rounded-md text-foreground outline-hidden group-data-[collapsible=icon]:hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Logotype label="" />
            <span className="font-medium">Ren</span>
          </Link>
          <SidebarToggle />
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        <SidebarGroup className="shrink-0 px-0">
          <SidebarMenu className="gap-1">
            <SidebarItem
              label="New chat"
              glyph="Compose"
              isActive={pathname === "/"}
              render={<Link to="/" activeOptions={{ exact: true }} />}
            />
            <SidebarItem
              label="Search"
              glyph="Search"
              shortcut="Meta+K Control+K"
              onClick={props.onSearch}
              trailing={
                <SidebarMenuBadge className="peer-data-[size=default]/menu-button:top-2">
                  <Kbd className="border">{Viewport.shortcut("K")}</Kbd>
                </SidebarMenuBadge>
              }
            />
            {pages.map((page) => (
              <SidebarItem
                key={page.to}
                label={page.label}
                glyph={page.glyph}
                isActive={pathname.startsWith(page.to)}
                render={<Link to={page.to} />}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="min-h-0 flex-1 px-0 pb-0 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="shrink-0 text-sm text-sidebar-foreground">Chats</SidebarGroupLabel>
          <SidebarGroupAction
            title="New chat"
            aria-label="New chat"
            onClick={dismiss}
            render={<Link to="/" activeOptions={{ exact: true }} />}
          >
            <Icon glyph="Plus" />
          </SidebarGroupAction>
          <SidebarGroupContent className="min-h-0 flex-1 scroll-fade-b overflow-y-auto overscroll-contain pb-2">
            <SidebarMenu className="gap-1">{props.chats}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-0 pb-0">{props.footer}</SidebarFooter>
    </Sidebar>
  )
}
