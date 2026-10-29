import { useState, useSyncExternalStore } from "react"
import { useQuery, useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { toast } from "sonner"
import { cn } from "cn"
import {
  IconBook,
  IconCalendar,
  IconChecklist,
  IconChevronUp,
  IconClock,
  IconCube,
  IconEdit,
  IconHelpCircle,
  IconActivity,
  IconLayoutGrid,
  IconMessage,
  IconLogout,
  IconPlus,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { FilterMenu, passes, type FilterProperty, type Filters } from "@/components/ren/filter-menu"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { CreateOrganizationDialog } from "@/components/ren/create-organization-dialog"
import { Logomark } from "@/components/ren/logomark"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { useMe } from "@/hooks/use-me"
import { useNow } from "@/hooks/use-now"
import { useSpaces } from "@/hooks/use-spaces"
import { auth, organizationsOptions } from "@/lib/auth"
import { resetSession } from "@/lib/chat"
import { initials } from "@/lib/format"
import { docsUrl, founderCallUrl } from "@/lib/links"
import { sessionTitle, sidebarSessionsOptions } from "@/lib/sessions"
import { openSearch } from "@/stores/ui"

const pages = [
  { to: "/spaces", label: "Spaces", icon: IconCube },
  { to: "/tasks", label: "Tasks", icon: IconChecklist },
  { to: "/schedules", label: "Scheduled", icon: IconClock },
  { to: "/marketplace", label: "Marketplace", icon: IconLayoutGrid },
] as const

const days = { today: 1, week: 7, month: 30 } as const
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

const row =
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

export function AppSidebar() {
  const path = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const me = useMe()
  const spaces = useSpaces().spaces
  const chatPages = useSuspenseInfiniteQuery(sidebarSessionsOptions())
  const allChats = chatPages.data.pages.flatMap((page) => page.items)
  const [filters, setFilters] = useState<Filters>({})
  const updated = (["today", "week", "month"] as const).find((key) => key === filters.updated?.at(0))
  const now = useNow()
  const chats = allChats.filter(
    (chat) =>
      passes(
        { space: filters.space ?? [], status: filters.status ?? [] },
        { space: [chat.spaceId], status: [chat.status] },
      ) &&
      (!updated || now - Date.parse(chat.updatedAt) <= days[updated] * 86_400_000),
  )
  const [organizationQuery, setOrganizationQuery] = useState("")
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const organizations = useQuery({ ...organizationsOptions(), enabled: switcherOpen })
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
    resetSession()
    await navigate({ to: "/" })
  }
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="p-0">
        <div className="mb-2 flex h-7 items-center gap-2 pl-2">
          <Logomark className="h-4 w-3.5 text-foreground" />
          <span className="flex-1 font-medium text-foreground">Ren</span>
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        <SidebarGroup className="shrink-0 px-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              <SidebarMenuItem>
                <SidebarMenuButton className={row} isActive={path === "/"} render={<Link to="/" />}>
                  <IconEdit />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className={row} onClick={openSearch}>
                  <IconSearch />
                  <span>Search</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>
                  <Kbd className="border">{shortcut}</Kbd>
                </SidebarMenuBadge>
              </SidebarMenuItem>
              {pages.map((page) => (
                <SidebarMenuItem key={page.to}>
                  <SidebarMenuButton className={row} isActive={path.startsWith(page.to)} render={<Link to={page.to} />}>
                    <page.icon />
                    <span>{page.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
              {chats.length === 0 ? (
                <li className="flex p-2 text-sm text-sidebar-foreground">
                  {allChats.length === 0 ? "No chats" : "No chats match these filters"}
                </li>
              ) : null}
              {chats.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    className={cn(row, "group-has-data-[sidebar=menu-badge]/menu-item:pr-7")}
                    isActive={path === `/sessions/${chat.id}`}
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
      </SidebarContent>
      <SidebarFooter className="px-0 pb-0">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem className="flex items-center gap-1">
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
                  <DropdownMenuRadioGroup
                    value={me.organization.id}
                    onValueChange={(value: string) => void switchTo(value)}
                  >
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
            <div className="flex">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Help" />}
                >
                  <IconHelpCircle />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      render={<a href={founderCallUrl} target="_blank" rel="noreferrer" aria-label="Talk to founder" />}
                    >
                      <IconCalendar />
                      Talk to founder
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      render={<a href={docsUrl} target="_blank" rel="noreferrer" aria-label="Documentation" />}
                    >
                      <IconBook />
                      Documentation
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Settings"
                nativeButton={false}
                render={<Link to="/settings/preferences" />}
              >
                <IconSettings />
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
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
            resetSession()
            await navigate({ to: "/login" })
          }}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
