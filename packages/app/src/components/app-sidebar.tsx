import { Link, useLocation } from "@tanstack/react-router"
import { IconBrowser, IconChecklist, IconCube, IconEdit, IconLayoutGridFilled, IconWebhook } from "@tabler/icons-react"
import { buttonVariants } from "@ren/ui/button"
import { Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarMenu, SidebarRail } from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { Preference } from "../lib/preference.js"
import { ChatsList, Footer, Header, NavRow, Section, sidebarMenu, useChatFilters } from "./sidebar-parts.js"
import { sidebarAction } from "./filter-menu.js"
import { SpacesList } from "./sidebar-spaces.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"

const newChat = { to: "/", label: "New chat", icon: IconEdit } as const
const tasks = { to: "/tasks", label: "Tasks", icon: IconChecklist } as const
const automations = { to: "/automations", label: "Automations", icon: IconWebhook } as const
const apps = { to: "/apps", label: "Apps", icon: IconLayoutGridFilled } as const
const artifacts = { to: "/artifacts", label: "Artifacts", icon: IconBrowser } as const
type Page = typeof newChat | typeof tasks | typeof automations | typeof artifacts | typeof apps

function Nav(props: { path: string; pages: ReadonlyArray<Page> }) {
  return (
    <SidebarGroup className="shrink-0 px-0.5 py-0">
      <SidebarMenu className={sidebarMenu}>
        {props.pages.map((page) => (
          <NavRow
            key={page.to}
            to={page.to}
            label={page.label}
            icon={page.icon}
            active={page.to === "/" ? props.path === "/" : props.path.startsWith(page.to)}
          />
        ))}
        <NavRow
          to="/spaces"
          label="Spaces"
          icon={IconCube}
          active={props.path.startsWith("/spaces")}
          className="hidden group-data-[collapsible=icon]:block"
        />
      </SidebarMenu>
    </SidebarGroup>
  )
}

function CollapsibleLayout(props: { path: string }) {
  const chats = useChatFilters()
  const sections = Preference.usePreference(SidebarPreferences.sections)
  const setPreference = Preference.useSetPreference()
  const toggle = (section: "spaces" | "chats") => {
    const next = { ...sections, [section]: !sections[section] }
    setPreference(SidebarPreferences.sections, next)
  }
  return (
    <>
      <SidebarContent className="scrollbar-thin overflow-y-auto overscroll-contain">
        <Nav path={props.path} pages={[newChat, tasks, automations, artifacts, apps]} />
        <Section
          label="Spaces"
          actions={
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    to="/spaces"
                    aria-label="All spaces"
                    className={buttonVariants({ variant: "ghost", size: "icon-sm", className: sidebarAction })}
                  />
                }
              >
                <IconCube />
              </TooltipTrigger>
              <TooltipContent>All spaces</TooltipContent>
            </Tooltip>
          }
          open={sections.spaces}
          onToggle={() => toggle("spaces")}
          className="shrink-0 group-data-[collapsible=icon]:hidden"
        >
          <SpacesList path={props.path} />
        </Section>
        <Section
          label="Chats"
          actions={chats.actions}
          open={sections.chats}
          onToggle={() => toggle("chats")}
          className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden"
        >
          <div className="-mr-0.5 min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain mask-b-from-95% pr-0.5">
            <ChatsList path={props.path} filters={chats.filters} filtered={chats.filtered} />
          </div>
        </Section>
      </SidebarContent>
      <Footer />
    </>
  )
}

export function AppSidebar(props: { onSearch: () => void }) {
  const path = useLocation({ select: (location) => location.pathname })
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="p-0">
        <Header onSearch={props.onSearch} />
      </SidebarHeader>
      <CollapsibleLayout path={path} />
      <SidebarRail />
    </Sidebar>
  )
}
