import type { SpaceInfo } from "@ren/client"
import { useState, useSyncExternalStore, type ReactNode } from "react"
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import {
  IconActivity,
  IconArchive,
  IconPencil,
  IconListSearch,
  IconBook,
  IconCalendar,
  IconChevronRight,
  IconCube,
  IconHelpCircle,
  IconLock,
  IconLogout,
  IconPlus,
  IconRoute,
  IconSearch,
  IconSelector,
  IconSettings,
  type Icon,
} from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button, buttonVariants } from "@ren/ui/button"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldLabel } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { Input } from "@ren/ui/input"
import { Kbd } from "@ren/ui/kbd"
import {
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarTrigger,
} from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { ConfirmDialog } from "./confirm-dialog.js"
import { CreateOrganizationDialog } from "./create-organization-dialog.js"
import { FilterMenu, type FilterProperty, type Filters } from "./filter-menu.js"
import { NewSpaceDialog } from "./new-space-dialog.js"
import { RowMenu } from "./row-menu.js"
import { errorMessage } from "../lib/errors.js"
import { formText } from "../lib/format.js"
import { Logomark } from "./logomark.js"
import { PersonAvatar } from "./person-avatar.js"
import { organizationsOptions } from "../lib/auth.js"
import { resetSession } from "../lib/chat.js"
import { initials } from "../lib/format.js"
import { docsUrl, founderCallUrl } from "../lib/links.js"
import { ownChats, sessionTitle, sidebarSessionsOptions, type SessionFilter } from "../lib/sessions.js"
import { useMe } from "../lib/use-me.js"
import { useSpaces } from "../lib/use-spaces.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"

export const sidebarRow =
  "h-9 gap-1 rounded-md p-1.5 text-sm font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground/80 active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-normal data-active:text-sidebar-accent-foreground data-active:hover:bg-sidebar-accent data-active:hover:text-sidebar-accent-foreground [&>svg]:m-0.75 [&_svg]:size-4.5"

const iconButton =
  "size-8 text-sidebar-foreground hover:bg-sidebar-accent active:not-aria-[haspopup]:scale-100 [&_svg]:size-4.5"

const shortcut = /Mac|iPhone|iPad/u.test(navigator.userAgent) ? "⌘K" : "Ctrl+K"

const shownSpaces = 3

export function Header(props: { onSearch: () => void }) {
  return (
    <div className="mt-1 mb-3.5 flex items-center px-1">
      <Link to="/" aria-label="Home" className={buttonVariants({ variant: "ghost", className: iconButton })}>
        <Logomark className="size-4.5" />
      </Link>
      <span className="flex-1" />
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" className={iconButton} aria-label="Search" onClick={props.onSearch} />}
        >
          <IconSearch />
        </TooltipTrigger>
        <TooltipContent>
          Search <Kbd>{shortcut}</Kbd>
        </TooltipContent>
      </Tooltip>
      <SidebarTrigger className={iconButton} />
    </div>
  )
}

export function NavRow(props: { to: string; label: string; icon: Icon; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton className={sidebarRow} isActive={props.active} render={<Link to={props.to} />}>
        <props.icon />
        <span>{props.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function Section(props: {
  label: string
  actions?: ReactNode | undefined
  open?: boolean | undefined
  onToggle?: (() => void) | undefined
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <SidebarGroup className={cn("px-0.5 pt-5 pb-0", props.className)}>
      <div className="group/section flex h-6 shrink-0 items-center pr-1 pb-1 pl-2.25">
        {props.onToggle ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={props.open}
            onClick={props.onToggle}
            className="h-auto justify-start gap-1 rounded-md p-0 text-sm font-medium text-sidebar-foreground/80 hover:bg-transparent active:not-aria-[haspopup]:scale-100 aria-expanded:bg-transparent aria-expanded:text-sidebar-foreground/80"
          >
            {props.label}
            <IconChevronRight
              aria-hidden
              className={cn(
                "size-3.5 opacity-0 transition-[transform,opacity] duration-150 ease-out group-focus-within/section:opacity-100 group-hover/section:opacity-100 motion-reduce:transition-none",
                props.open && "rotate-90",
              )}
            />
          </Button>
        ) : (
          <span className="text-sm font-medium text-sidebar-foreground/80">{props.label}</span>
        )}
        <span className="flex-1" />
        <span className="flex items-center">{props.actions}</span>
      </div>
      {props.open === false ? null : props.children}
    </SidebarGroup>
  )
}

function SpaceChats(props: { space: SpaceInfo; path: string }) {
  const { client } = RouterContext.useRouterContext()
  const [shown, setShown] = useState(5)
  const chats = useInfiniteQuery(sidebarSessionsOptions(client, { spaceId: [props.space.id] }))
  const items = chats.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <section aria-label={`Chats in ${props.space.name}`}>
      <SidebarMenu className="gap-px">
        {chats.isPending ? <SidebarMenuSkeleton className="h-9" /> : null}
        {chats.isError ? (
          <SidebarMenuItem>
            <SidebarMenuButton className={cn(sidebarRow, "pl-8.5")} onClick={() => void chats.refetch()}>
              Retry loading chats
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {chats.isSuccess && items.length === 0 ? (
          <li className="py-2 pr-2 pl-9 text-sm text-sidebar-foreground">No chats yet</li>
        ) : null}
        {items.slice(0, shown).map((chat) => (
          <SidebarMenuItem key={chat.id}>
            <SidebarMenuButton
              className={cn(sidebarRow, "pl-8.5 group-has-data-[sidebar=menu-badge]/menu-item:pr-7")}
              isActive={props.path === `/sessions/${chat.id}`}
              render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
            >
              <span>{sessionTitle(chat.title)}</span>
            </SidebarMenuButton>
            <ChatStatus sessionId={chat.id} busy={chat.status === "busy"} />
          </SidebarMenuItem>
        ))}
        {items.length > shown || chats.hasNextPage ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(sidebarRow, "pl-8.5 font-medium text-sidebar-foreground")}
              disabled={chats.isFetchingNextPage}
              onClick={() => {
                if (items.length <= shown) void chats.fetchNextPage()
                setShown((count) => count + 5)
              }}
            >
              <span>Show more</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </section>
  )
}

function RenameSpaceDialog(props: { space: SpaceInfo; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.space.update.mutationOptions())
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            update.mutate(
              { id: props.space.id, name: formText(new FormData(event.currentTarget), "name").trim() },
              {
                onSuccess: () => props.onOpenChange(false),
                onError: (error) => toast.error("Could not rename the space", { description: errorMessage(error) }),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename space</DialogTitle>
            <DialogDescription>Change the name of {props.space.name}.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rename-space-name">Name</FieldLabel>
            <Input id="rename-space-name" name="name" defaultValue={props.space.name} required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SpaceEntry(props: { space: SpaceInfo; path: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const archive = useMutation(api.space.archive.mutationOptions())
  return (
    <SidebarMenuItem>
      <div
        data-active={props.path.startsWith(`/spaces/${props.space.id}`) || undefined}
        className="group/space flex items-center rounded-md hover:bg-sidebar-accent has-focus-visible:ring-2 has-focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent"
      >
        <SidebarMenuButton
          className={cn(
            sidebarRow,
            "min-w-0 flex-1 gap-2 py-1.5 pr-1 pl-1.5 hover:bg-transparent focus-visible:ring-0 active:bg-transparent data-active:bg-transparent data-active:hover:bg-transparent",
          )}
          aria-expanded={open}
          isActive={props.path.startsWith(`/spaces/${props.space.id}`)}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="flex size-6 shrink-0 items-center justify-center text-current">
            {props.space.kind === "private" ? <IconLock /> : <IconCube />}
          </span>
          <span>{props.space.name}</span>
        </SidebarMenuButton>
        <span className="flex shrink-0 items-center pr-1 group-focus-within/space:opacity-100 group-hover/space:opacity-100 has-data-popup-open:opacity-100 md:opacity-0">
          {props.space.membershipId !== null ? (
            <Link
              to="/"
              search={{ spaceId: props.space.id }}
              aria-label={`New chat in ${props.space.name}`}
              className={buttonVariants({
                variant: "ghost",
                size: "icon-sm",
                className:
                  "text-sidebar-foreground hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 active:not-aria-[haspopup]:scale-100 aria-expanded:bg-transparent",
              })}
            >
              <IconPlus />
            </Link>
          ) : null}
          <RowMenu
            side="right"
            className="text-sidebar-foreground hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 active:not-aria-[haspopup]:scale-100 aria-expanded:bg-transparent"
            label={`${props.space.name} actions`}
            items={[
              ...(props.space.canUpdate
                ? [{ label: "Rename", icon: IconPencil, onSelect: () => setRenaming(true) }]
                : []),
              {
                label: "Settings",
                icon: IconSettings,
                onSelect: () => navigate({ to: "/spaces/$spaceId", params: { spaceId: props.space.id } }),
              },
              ...(props.space.canArchive
                ? [
                    {
                      label: "Archive space",
                      icon: IconArchive,
                      onSelect: () =>
                        archive.mutateAsync(
                          { id: props.space.id },
                          {
                            onSuccess: () => toast.success(`${props.space.name} archived`),
                            onError: (error) =>
                              toast.error("Could not archive the space", { description: errorMessage(error) }),
                          },
                        ),
                      confirm: {
                        title: `Archive “${props.space.name}”?`,
                        description: "Its members lose access. Only the API can bring it back.",
                        action: "Archive",
                      },
                    },
                  ]
                : []),
            ]}
          />
        </span>
      </div>
      {open ? <SpaceChats space={props.space} path={props.path} /> : null}
      <RenameSpaceDialog space={props.space} open={renaming} onOpenChange={setRenaming} />
    </SidebarMenuItem>
  )
}

export function SpacesList(props: { path: string }) {
  const spaces = useSpaces().spaces
  const [creating, setCreating] = useState(false)
  return (
    <section aria-label="Sidebar spaces">
      <SidebarMenu className="gap-px">
        {spaces.slice(0, shownSpaces).map((space) => (
          <SpaceEntry key={space.id} space={space} path={props.path} />
        ))}
        {spaces.length === 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton className={cn(sidebarRow, "text-sidebar-foreground")} onClick={() => setCreating(true)}>
              <IconPlus />
              <span>Add space</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {spaces.length > shownSpaces ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(sidebarRow, "px-2 font-medium text-sidebar-foreground")}
              render={<Link to="/spaces" />}
            >
              <span>See all</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
      <NewSpaceDialog open={creating} onOpenChange={setCreating} />
    </section>
  )
}

export function SpacesActions() {
  const spaces = useSpaces().spaces
  const [creating, setCreating] = useState(false)
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/spaces"
              aria-label="All spaces"
              className={buttonVariants({
                variant: "ghost",
                size: "icon-sm",
                className: "text-sidebar-foreground active:not-aria-[haspopup]:scale-100",
              })}
            />
          }
        >
          <IconListSearch />
        </TooltipTrigger>
        <TooltipContent>All spaces</TooltipContent>
      </Tooltip>
      {spaces.length > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add space"
                className="text-sidebar-foreground active:not-aria-[haspopup]:scale-100"
                onClick={() => setCreating(true)}
              />
            }
          >
            <IconPlus />
          </TooltipTrigger>
          <TooltipContent>Add space</TooltipContent>
        </Tooltip>
      ) : null}
      <NewSpaceDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

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
    options: spaces.map((space) => ({ value: space.id, label: space.name })),
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
  { key: "origin", label: "Started from", any: "Anywhere", icon: IconRoute, options: [...origins] },
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
    <SidebarMenuBadge className="right-2 peer-data-[size=default]/menu-button:top-2">
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

export function useChatFilters() {
  const spaces = useSpaces().spaces
  const [filters, setFilters] = useState<Filters>({})
  return {
    filters,
    actions: (
      <>
        <FilterMenu
          label="Filter chats"
          trigger="sidebar"
          properties={chatProperties(spaces)}
          value={filters}
          onChange={setFilters}
        />
        <Link
          to="/"
          aria-label="New chat"
          className={buttonVariants({
            variant: "ghost",
            size: "icon-sm",
            className: "text-sidebar-foreground active:not-aria-[haspopup]:scale-100",
          })}
        >
          <IconPlus />
        </Link>
      </>
    ),
  }
}

export function ChatsList(props: { path: string; filters: Filters }) {
  const { client } = RouterContext.useRouterContext()
  const me = useMe()
  const filtered = Object.values(props.filters).some((values) => values.length > 0)
  const chatPages = useInfiniteQuery({
    ...sidebarSessionsOptions(client, chatFilter(props.filters, me.user.id)),
    placeholderData: keepPreviousData,
  })
  const chats = chatPages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <SidebarGroupContent className="pb-2">
      <SidebarMenu className="gap-px">
        {chatPages.isSuccess && chats.length === 0 ? (
          <li className="flex h-9 items-center pl-2.25 text-sm text-sidebar-foreground">
            {filtered ? "No chats match these filters" : "No chats yet"}
          </li>
        ) : null}
        {chats.map((chat) => (
          <SidebarMenuItem key={chat.id}>
            <SidebarMenuButton
              className={cn(sidebarRow, "py-1.5 pr-2 pl-2.25 group-has-data-[sidebar=menu-badge]/menu-item:pr-7")}
              isActive={props.path === `/sessions/${chat.id}`}
              render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
            >
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
                <SidebarMenuSkeleton className="h-9" />
              </SidebarMenuItem>
            ))
          : null}
      </SidebarMenu>
    </SidebarGroupContent>
  )
}

export function UserRow() {
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
              className="h-10 min-w-0 flex-1 gap-1.5 rounded-md py-1.5 pr-2 pl-1.5 hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
              aria-label={`Switch organization (current: ${me.organization.name})`}
            />
          }
        >
          <Avatar className="size-7">
            {me.user.image ? <AvatarImage src={me.user.image} alt="" /> : null}
            <AvatarFallback className="text-xs">{initials(userName)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col text-start leading-tight">
            <span className="truncate text-sm font-medium tracking-tight text-sidebar-foreground">{userName}</span>
            <span className="truncate text-xs text-sidebar-foreground/80">{me.organization.name}</span>
          </span>
          <IconSelector className="text-sidebar-foreground" />
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

export function HelpAndSettings() {
  const platform = Platform.usePlatform()
  return (
    <div className="flex shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className={iconButton} aria-label="Help" />}>
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
        className={buttonVariants({ variant: "ghost", className: iconButton })}
      >
        <IconSettings />
      </Link>
    </div>
  )
}

export function Footer() {
  return (
    <SidebarFooter className="gap-1 px-0.5 pt-2 pb-0">
      <SidebarMenu>
        <SidebarMenuItem className="flex items-center gap-0.5">
          <UserRow />
          <HelpAndSettings />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
