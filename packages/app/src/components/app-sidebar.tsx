import { useState, useSyncExternalStore } from "react"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import {
  IconBook,
  IconCalendar,
  IconRoute,
  IconChecklist,
  IconChevronRight,
  IconChevronUp,
  IconClock,
  IconCube,
  IconEdit,
  IconHelpCircle,
  IconActivity,
  IconLayoutGrid,
  IconLock,
  IconMessage,
  IconLogout,
  IconPlus,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button, buttonVariants } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Input } from "@ren/ui/input"
import { Kbd } from "@ren/ui/kbd"
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
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
} from "@ren/ui/sidebar"
import { FilterMenu, type FilterProperty, type Filters } from "./filter-menu.js"
import { ConfirmDialog } from "./confirm-dialog.js"
import { CreateOrganizationDialog } from "./create-organization-dialog.js"
import { PersonAvatar } from "./person-avatar.js"
import { useMe } from "../lib/use-me.js"
import { useSpaces } from "../lib/use-spaces.js"
import { organizationsOptions } from "../lib/auth.js"
import { resetSession } from "../lib/chat.js"
import { initials } from "../lib/format.js"
import { docsUrl, founderCallUrl } from "../lib/links.js"
import { ownChats, sessionTitle, sidebarSessionsOptions, type SessionFilter } from "../lib/sessions.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"

const pages = [
  { to: "/spaces", label: "Spaces", icon: IconCube },
  { to: "/tasks", label: "Tasks", icon: IconChecklist },
  { to: "/schedules", label: "Scheduled", icon: IconClock },
  { to: "/marketplace", label: "Marketplace", icon: IconLayoutGrid },
] as const

const days = { today: 0, week: 7, month: 30 } as const

const origins = [
  { value: "chat", label: "Chat" },
  { value: "task", label: "Task" },
  { value: "schedule", label: "Schedule" },
  { value: "slack", label: "Slack" },
  { value: "linear", label: "Linear" },
  { value: "github", label: "GitHub" },
  { value: "webhook", label: "Webhook" },
] as const

type Origin = (typeof origins)[number]["value"]

const isOrigin = (value: string): value is Origin => origins.some((origin) => origin.value === value)

const startOfDayAgo = (daysAgo: number) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(today.getTime() - daysAgo * 86_400_000).toISOString()
}

const chatFilter = (filters: Filters, userId: string): SessionFilter => {
  const status = filters.status?.length === 1 ? filters.status.at(0) : undefined
  const updated = (["today", "week", "month"] as const).find((key) => key === filters.updated?.at(0))
  const origin = (filters.origin ?? []).filter(isOrigin)
  return {
    ...ownChats(userId),
    ...(filters.space?.length && { spaceId: filters.space }),
    ...((status === "idle" || status === "busy") && { status }),
    ...(origin.length > 0 && { origin }),
    ...(updated && { from: startOfDayAgo(days[updated]) }),
  }
}
const chatProperties = (spaces: ReadonlyArray<{ id: string; name: string }>): FilterProperty[] => [
  {
    key: "space",
    label: "Space",
    any: "All spaces",
    icon: IconCube,
    options: spaces.map((space) => ({
      value: space.id,
      label: space.name,
    })),
  },
  {
    key: "status",
    label: "Status",
    any: "Any",
    icon: IconActivity,
    options: [
      { value: "busy", label: "Working" },
      { value: "idle", label: "Idle" },
    ],
  },
  {
    key: "origin",
    label: "Started from",
    any: "Anywhere",
    icon: IconRoute,
    options: [...origins],
  },
  {
    key: "updated",
    label: "Updated",
    any: "Any time",
    icon: IconCalendar,
    single: true,
    options: [
      { value: "today", label: "Today" },
      { value: "week", label: "Past 7 days" },
      { value: "month", label: "Past 30 days" },
    ],
  },
]

const shortcut = /Mac|iPhone|iPad/u.test(navigator.userAgent) ? "⌘K" : "Ctrl+K"

export const sidebarRow =
  "h-7.5 font-medium [&_svg]:size-4.5 [&_svg]:text-sidebar-foreground/70 data-active:[&_svg]:text-sidebar-accent-foreground"

function useChatAttention(sessionId: string) {
  const atoms = ChatReact.useAtoms()
  return useSyncExternalStore(
    (listener) => atoms.attention.subscribe(() => queueMicrotask(listener)),
    () => atoms.attention.read(Session.ID.make(sessionId)),
  )
}

function ChatStatus(props: { sessionId: string; busy: boolean }) {
  const attention = useChatAttention(props.sessionId) ?? (props.busy ? "running" : "idle")
  if (attention === "idle") return null
  return (
    <SidebarMenuBadge className="peer-data-[size=default]/menu-button:top-2">
      <span
        className={attention === "asking" ? "size-2 rounded-full bg-chart-3" : "size-2 rounded-full bg-chart-2"}
        aria-label={attention === "asking" ? "Needs your input" : "Working"}
      />
    </SidebarMenuBadge>
  )
}

const spaceRow =
  "h-7.5 font-medium [&>svg]:size-4 [&>svg]:text-sidebar-foreground/70 data-active:[&>svg]:text-sidebar-accent-foreground"

function SpacesTree(props: { path: string }) {
  const spaces = useSpaces().spaces
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <SidebarMenuButton className={sidebarRow} isActive={props.path === "/spaces"} render={<Link to="/spaces" />}>
        <IconCube />
        <span>Spaces</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        render={<CollapsibleTrigger />}
        aria-label={open ? "Collapse spaces" : "Expand spaces"}
        className="peer-data-[size=default]/menu-button:top-1.25 aria-expanded:[&>svg]:rotate-90"
      >
        <IconChevronRight className="transition-transform duration-150 ease-out" />
      </SidebarMenuAction>
      <CollapsibleContent>
        <SidebarMenuSub className="mr-0 gap-px pr-0">
          {spaces.map((space) => (
            <SidebarMenuSubItem key={space.id}>
              <SidebarMenuSubButton
                className={spaceRow}
                isActive={props.path.startsWith(`/spaces/${space.id}`)}
                render={<Link to="/spaces/$spaceId" params={{ spaceId: space.id }} />}
              >
                {space.kind === "private" ? <IconLock /> : <IconCube />}
                <span>{space.name}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

function LoadMore(props: { onVisible: () => void }) {
  return (
    <li
      aria-hidden
      className="h-px"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) props.onVisible()
          },
          { rootMargin: "240px 0px" },
        )
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}

function NavMain(props: { path: string; onSearch: () => void }) {
  return (
    <SidebarMenu className="gap-px">
      <SidebarMenuItem>
        <SidebarMenuButton className={sidebarRow} isActive={props.path === "/"} render={<Link to="/" />}>
          <IconEdit />
          <span>New chat</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton className={sidebarRow} onClick={props.onSearch}>
          <IconSearch />
          <span>Search</span>
        </SidebarMenuButton>
        <SidebarMenuBadge>
          <Kbd className="border">{shortcut}</Kbd>
        </SidebarMenuBadge>
      </SidebarMenuItem>
      {pages.map((page) =>
        page.to === "/spaces" ? (
          <SpacesTree key={page.to} path={props.path} />
        ) : (
          <SidebarMenuItem key={page.to}>
            <SidebarMenuButton
              className={sidebarRow}
              isActive={props.path.startsWith(page.to)}
              render={<Link to={page.to} />}
            >
              <page.icon />
              <span>{page.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ),
      )}
    </SidebarMenu>
  )
}

function NavChats(props: { path: string }) {
  const { client } = RouterContext.useRouterContext()
  const me = useMe()
  const spaces = useSpaces().spaces
  const [filters, setFilters] = useState<Filters>({})
  const filtered = Object.values(filters).some((values) => values.length > 0)
  const chatPages = useInfiniteQuery({
    ...sidebarSessionsOptions(client, chatFilter(filters, me.user.id)),
    placeholderData: keepPreviousData,
  })
  const chats = chatPages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <SidebarGroup className="min-h-0 flex-1 px-0 pb-0">
      <SidebarGroupLabel className="shrink-0 font-medium text-muted-foreground">Chats</SidebarGroupLabel>
      <div className="absolute top-3.5 right-9 flex group-data-[collapsible=icon]:hidden">
        <FilterMenu
          label="Filter chats"
          trigger="sidebar"
          properties={chatProperties(spaces)}
          value={filters}
          onChange={setFilters}
        />
      </div>
      <SidebarGroupAction title="New chat" render={<Link to="/" />}>
        <IconPlus />
      </SidebarGroupAction>
      <SidebarGroupContent className="min-h-0 flex-1 scroll-fade-b scrollbar-thin overflow-y-auto overscroll-contain pb-2">
        <SidebarMenu className="gap-px">
          {chatPages.isSuccess && chats.length === 0 ? (
            <li className="flex p-2 text-sm text-sidebar-foreground">
              {filtered ? "No chats match these filters" : "No chats"}
            </li>
          ) : null}
          {chats.map((chat) => (
            <SidebarMenuItem key={chat.id}>
              <SidebarMenuButton
                className={cn(sidebarRow, "group-has-data-[sidebar=menu-badge]/menu-item:pr-7")}
                isActive={props.path === `/sessions/${chat.id}`}
                render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
              >
                <IconMessage />
                <span>{sessionTitle(chat.title)}</span>
              </SidebarMenuButton>
              <ChatStatus sessionId={chat.id} busy={chat.status === "busy"} />
            </SidebarMenuItem>
          ))}
          {chatPages.hasNextPage ? (
            <LoadMore
              onVisible={() => {
                if (!chatPages.isFetchingNextPage) void chatPages.fetchNextPage()
              }}
            />
          ) : null}
          {chatPages.isFetchingNextPage
            ? Array.from({ length: 3 }, (_, index) => (
                <SidebarMenuItem key={`loading-${index}`}>
                  <SidebarMenuSkeleton className="h-7.5" showIcon />
                </SidebarMenuItem>
              ))
            : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function NavUser() {
  const { auth, platform, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const me = useMe()
  const [organizationQuery, setOrganizationQuery] = useState("")
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const organizations = useQuery({ ...organizationsOptions(auth), enabled: switcherOpen })
  const listed = organizations.data ?? []
  const allOrganizations = listed.some((organization) => organization.id === me.organization.id)
    ? listed
    : [me.organization, ...listed]
  const matchingOrganizations = allOrganizations.filter((organization) =>
    organization.name.toLowerCase().includes(organizationQuery.trim().toLowerCase()),
  )
  const userName = me.user.name || me.user.email
  const switchTo = async (organizationId: string) => {
    if (organizationId === me.organization.id) return
    const result = await auth.organization.setActive({ organizationId })
    if (result.error !== null) {
      toast.error("Couldn’t switch organization", { description: result.error.message ?? undefined })
      return
    }
    resetSession(queryClient)
    await navigate({ to: "/" })
  }
  return (
    <>
      <DropdownMenu open={switcherOpen} onOpenChange={setSwitcherOpen}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="h-10 min-w-0 flex-1 pl-3"
              aria-label={`Switch organization (current: ${me.organization.name})`}
            />
          }
        >
          <Avatar>
            {me.user.image ? <AvatarImage src={me.user.image} alt="" /> : null}
            <AvatarFallback>{initials(userName)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col text-start leading-tight">
            <span className="truncate font-medium text-foreground">{userName}</span>
            <span className="truncate text-xs text-muted-foreground/70">{me.organization.name}</span>
          </span>
          <IconChevronUp />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <div className="relative p-1">
            <IconSearch className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={organizationQuery}
              onChange={(event) => setOrganizationQuery(event.currentTarget.value)}
              placeholder="Find organization"
              aria-label="Find organization"
              onKeyDown={(event) => {
                if (event.key.length === 1) event.stopPropagation()
              }}
              className="h-7 pl-7 text-xs md:text-xs"
            />
          </div>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={me.organization.id} onValueChange={(value: string) => void switchTo(value)}>
              {matchingOrganizations.map((organization) => (
                <DropdownMenuRadioItem key={organization.id} value={organization.id}>
                  <PersonAvatar name={organization.name} />
                  {organization.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setCreating(true)}>
              <IconPlus />
              Create organization
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLoggingOut(true)}>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={loggingOut}
        onOpenChange={setLoggingOut}
        confirmation={{
          title: "Log out?",
          description: "You’ll need to sign in again to access Ren.",
          action: "Log out",
        }}
        onConfirm={async () => {
          await auth.signOut()
          platform.analytics?.reset()
          resetSession(queryClient)
          await navigate({ to: "/login" })
        }}
      />
    </>
  )
}

function NavHelp() {
  const platform = Platform.usePlatform()
  return (
    <div className="flex">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Help" />}
        >
          <IconHelpCircle />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => platform.openExternal(founderCallUrl)}>
              <IconCalendar />
              Talk to founder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => platform.openExternal(docsUrl)}>
              <IconBook />
              Documentation
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Link
        to="/settings/preferences"
        aria-label="Settings"
        className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "text-muted-foreground" })}
      >
        <IconSettings />
      </Link>
    </div>
  )
}

export function AppSidebar(props: { onSearch: () => void }) {
  const path = useLocation({ select: (location) => location.pathname })
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="p-0">
        <div className="mb-2 flex h-7 items-center gap-2 pl-2">
          <span className="flex-1 font-medium text-foreground">Ren</span>
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        <SidebarGroup className="shrink-0 px-0">
          <SidebarGroupContent>
            <NavMain path={path} onSearch={props.onSearch} />
          </SidebarGroupContent>
        </SidebarGroup>
        <NavChats path={path} />
      </SidebarContent>
      <SidebarFooter className="px-0 pb-0">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem className="flex items-center gap-1">
            <NavUser />
            <NavHelp />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
