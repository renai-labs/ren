import { useState } from "react"
import { useLocation } from "@tanstack/react-router"
import { IconClockBolt, IconChecklist, IconCube, IconEdit, IconLayoutGrid } from "@tabler/icons-react"
import { Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarMenu, SidebarRail } from "@ren/ui/sidebar"
import {
  ChatSearchButton,
  ChatsList,
  Footer,
  Header,
  NavRow,
  Section,
  SpacesActions,
  useChatFilters,
} from "./sidebar-parts.js"
import { SpacesList } from "./sidebar-spaces.js"
import { RouterContext } from "../lib/router-context.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"
import { SidebarLayout } from "../lib/sidebar-layout.js"

const newChat = { to: "/", label: "New Chat", icon: IconEdit } as const
const tasks = { to: "/tasks", label: "Tasks", icon: IconChecklist } as const
const automations = { to: "/automations", label: "Automations", icon: IconClockBolt } as const
const marketplace = { to: "/marketplace", label: "Marketplace", icon: IconLayoutGrid } as const
const spaces = { to: "/spaces", label: "Spaces", icon: IconCube } as const
type Page = typeof newChat | typeof tasks | typeof automations | typeof spaces | typeof marketplace

function Nav(props: { path: string; pages: ReadonlyArray<Page> }) {
  const listed = props.pages.some((page) => page.to === "/spaces")
  return (
    <SidebarGroup className="shrink-0 px-0.5 py-0">
      <SidebarMenu className="gap-0.5">
        {props.pages.map((page) => (
          <NavRow
            key={page.to}
            to={page.to}
            label={page.label}
            icon={page.icon}
            active={page.to === "/" ? props.path === "/" : props.path.startsWith(page.to)}
          />
        ))}
        {listed ? null : (
          <NavRow
            to="/spaces"
            label="Spaces"
            icon={IconCube}
            active={props.path.startsWith("/spaces")}
            className="hidden group-data-[collapsible=icon]:block"
          />
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function CollapsibleLayout(props: { path: string; onSearchChats: () => void }) {
  const { platform } = RouterContext.useRouterContext()
  const chats = useChatFilters()
  const grouped = SidebarLayout.useGrouped(platform.storage).grouped
  const [sections, setSections] = useState(() => SidebarPreferences.sections.read(platform.storage))
  const toggle = (section: "spaces" | "chats") => {
    const next = { ...sections, [section]: !sections[section] }
    SidebarPreferences.sections.write(platform.storage, next)
    setSections(next)
  }
  return (
    <>
      <SidebarContent className="scrollbar-thin overflow-y-auto overscroll-contain">
        <Nav
          path={props.path}
          pages={
            grouped ? [newChat, tasks, automations, spaces, marketplace] : [newChat, tasks, automations, marketplace]
          }
        />
        {grouped ? null : (
          <Section
            label="Spaces"
            actions={<SpacesActions />}
            open={sections.spaces}
            onToggle={() => toggle("spaces")}
            className="shrink-0 group-data-[collapsible=icon]:hidden"
          >
            <SpacesList path={props.path} />
          </Section>
        )}
        <Section
          label="Chats"
          actions={
            <>
              <ChatSearchButton onClick={props.onSearchChats} />
              {chats.actions}
            </>
          }
          open={sections.chats}
          onToggle={() => toggle("chats")}
          className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden"
        >
          <div className="-mr-0.5 min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain mask-b-from-95% pr-0.5">
            <ChatsList path={props.path} filters={chats.filters} grouped={grouped} />
          </div>
        </Section>
      </SidebarContent>
      <Footer />
    </>
  )
}

export function AppSidebar(props: { onSearch: () => void; onSearchChats: () => void }) {
  const path = useLocation({ select: (location) => location.pathname })
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="p-0">
        <Header onSearch={props.onSearch} />
      </SidebarHeader>
      <CollapsibleLayout path={path} onSearchChats={props.onSearchChats} />
      <SidebarRail />
    </Sidebar>
  )
}
