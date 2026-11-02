import { useState } from "react"
import { useLocation } from "@tanstack/react-router"
import { IconChecklist, IconClock, IconEdit, IconLayoutGrid } from "@tabler/icons-react"
import { Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarMenu } from "@ren/ui/sidebar"
import {
  ChatsList,
  Footer,
  Header,
  NavRow,
  Section,
  SpacesActions,
  SpacesList,
  useChatFilters,
} from "./sidebar-parts.js"

const newChat = { to: "/", label: "New chat", icon: IconEdit } as const
const tasks = { to: "/tasks", label: "Tasks", icon: IconChecklist } as const
const scheduled = { to: "/schedules", label: "Scheduled", icon: IconClock } as const
const marketplace = { to: "/marketplace", label: "Marketplace", icon: IconLayoutGrid } as const
type Page = typeof newChat | typeof tasks | typeof scheduled | typeof marketplace

function Nav(props: { path: string; pages: ReadonlyArray<Page> }) {
  return (
    <SidebarGroup className="shrink-0 px-0.5 py-0">
      <SidebarMenu className="gap-1">
        {props.pages.map((page) => (
          <NavRow
            key={page.to}
            to={page.to}
            label={page.label}
            icon={page.icon}
            active={page.to === "/" ? props.path === "/" : props.path.startsWith(page.to)}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function CollapsibleLayout(props: { path: string }) {
  const chats = useChatFilters()
  const [spacesOpen, setSpacesOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)
  return (
    <>
      <SidebarContent className="scrollbar-thin overflow-y-auto overscroll-contain">
        <Nav path={props.path} pages={[newChat, tasks, scheduled, marketplace]} />
        <Section
          label="Spaces"
          actions={<SpacesActions />}
          open={spacesOpen}
          onToggle={() => setSpacesOpen((open) => !open)}
          className="shrink-0"
        >
          <SpacesList path={props.path} />
        </Section>
        <Section
          label="Chats"
          actions={chats.actions}
          open={chatsOpen}
          onToggle={() => setChatsOpen((open) => !open)}
          className="shrink-0"
        >
          <ChatsList path={props.path} filters={chats.filters} />
        </Section>
      </SidebarContent>
      <Footer />
    </>
  )
}

export function AppSidebar(props: { onSearch: () => void }) {
  const path = useLocation({ select: (location) => location.pathname })
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="p-0">
        <Header onSearch={props.onSearch} />
      </SidebarHeader>
      <CollapsibleLayout path={path} />
    </Sidebar>
  )
}
