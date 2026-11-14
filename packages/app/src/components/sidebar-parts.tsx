import type { SpaceInfo } from "@ren/client"
import { useState, type ReactNode } from "react"
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { DateTime } from "effect"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import {
  IconActivity,
  IconArchive,
  IconBook,
  IconCalendar,
  IconCalendarEvent,
  IconCalendarMonth,
  IconCalendarWeek,
  IconChevronRight,
  IconCircle,
  IconCube,
  IconHelpCircle,
  IconLock,
  IconLogout,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconPlus,
  IconProgress,
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
  SidebarTrigger,
} from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { ConfirmDialog } from "./confirm-dialog.js"
import { CreateOrganizationDialog } from "./create-organization-dialog.js"
import { FilterMenu, sameFilters, spaceOptions, type FilterProperty, type Filters } from "./filter-menu.js"
import { RowMenu } from "./row-menu.js"
import { errorMessage } from "../lib/errors.js"
import { formText } from "../lib/format.js"
import { Logomark } from "../icons/logomark.js"
import { PersonAvatar } from "./person-avatar.js"
import { organizationsOptions } from "../lib/auth.js"
import { resetSession } from "../lib/chat.js"
import { initials } from "../lib/format.js"
import { docsUrl, founderCallUrl } from "../lib/links.js"
import {
  isOrigin,
  origins,
  ownChats,
  sessionTitle,
  sidebarSessionsOptions,
  useChatAttention,
  type SessionFilter,
} from "../lib/sessions.js"
import { Preference } from "../lib/preference.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"
import { useMe } from "../lib/use-me.js"
import { isPersonal } from "../lib/use-pinned-spaces.js"
import { useSpaces } from "../lib/use-spaces.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"

export const sidebarRow =
  "[&_svg]:text-sidebar-foreground/55 hover:[&_svg]:text-sidebar-foreground data-active:[&_svg]:text-sidebar-accent-foreground h-8 gap-1 rounded-md p-1 text-sm font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground/80 active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-normal data-active:text-sidebar-accent-foreground data-active:hover:bg-sidebar-accent data-active:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:[&_svg]:size-5 group-data-[collapsible=icon]:[&>svg]:m-0 [&>svg]:mx-1.25 [&>svg]:my-0.75 [&_svg]:size-4.5"

export const sidebarMenu = "gap-px group-data-[collapsible=icon]:gap-1"

const iconButton =
  "size-8 text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent active:not-aria-[haspopup]:scale-100 group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:[&_svg]:size-5 [&_svg]:size-4.5"

const shortcut = /Mac|iPhone|iPad/u.test(navigator.userAgent) ? "⌘K" : "Ctrl+K"

function SearchButton(props: { onSearch: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-sidebar-foreground/55 hover:text-sidebar-foreground"
            aria-label="Search"
            onClick={props.onSearch}
          />
        }
      >
        <IconSearch data-weight="heavy" />
      </TooltipTrigger>
      <TooltipContent>
        Search <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

export function Header(props: { onSearch?: (() => void) | undefined }) {
  return (
    <div className="mt-1 mb-3.5 flex items-center px-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:px-0.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center text-sidebar-foreground group-data-[collapsible=icon]:size-9"
      >
        <Logomark className="size-4.5" />
      </span>
      <span className="flex-1 text-base font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        Ren
      </span>
      {props.onSearch ? (
        <span className="group-data-[collapsible=icon]:hidden">
          <SearchButton onSearch={props.onSearch} />
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={<SidebarTrigger className={cn(iconButton, "hidden group-data-[collapsible=icon]:flex")} />}
        />
        <TooltipContent>Toggle sidebar</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function NavRow(props: {
  to: string
  label: string
  icon: Icon
  active: boolean
  className?: string | undefined
}) {
  return (
    <SidebarMenuItem className={props.className}>
      <SidebarMenuButton
        className={sidebarRow}
        isActive={props.active}
        tooltip={props.label}
        render={<Link to={props.to} />}
      >
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
  closed?: ReactNode
  children: ReactNode
}) {
  return (
    <SidebarGroup className={cn("px-0.5 pt-5 pb-0 group-data-[collapsible=icon]:pt-3", props.className)}>
      <div className="group/section flex h-6 shrink-0 items-center pr-1 pb-1 pl-2.25 group-data-[collapsible=icon]:hidden">
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
        ) : null}
        {!props.onToggle ? <span className="text-sm font-medium text-sidebar-foreground/80">{props.label}</span> : null}
        <span className="flex-1" />
        <span className="flex items-center">{props.actions}</span>
      </div>
      {props.open === false ? props.closed : props.children}
    </SidebarGroup>
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

export function SpaceEntry(props: {
  space: SpaceInfo
  path: string
  pinned: boolean
  onPin: (pinned: boolean) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState(false)
  const archive = useMutation(api.space.archive.mutationOptions())
  return (
    <SidebarMenuItem>
      <div
        data-active={props.path.startsWith(`/spaces/${props.space.id}`) || undefined}
        className="group/space relative flex items-center rounded-md hover:bg-sidebar-accent has-focus-visible:ring-2 has-focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent"
      >
        <SidebarMenuButton
          className={cn(
            sidebarRow,
            "min-w-0 flex-1 gap-2 py-1 pl-1.5 hover:bg-transparent focus-visible:ring-0 active:bg-transparent data-active:bg-transparent data-active:hover:bg-transparent",
            props.space.membershipId === null
              ? "pr-8 pointer-fine:pr-1 pointer-fine:group-focus-within/space:pr-8 pointer-fine:group-hover/space:pr-8 pointer-fine:group-has-data-popup-open/space:pr-8"
              : "pr-15 pointer-fine:pr-1 pointer-fine:group-focus-within/space:pr-15 pointer-fine:group-hover/space:pr-15 pointer-fine:group-has-data-popup-open/space:pr-15",
          )}
          isActive={props.path.startsWith(`/spaces/${props.space.id}`)}
          render={<Link to="/spaces/$spaceId" params={{ spaceId: props.space.id }} />}
        >
          <span className="flex size-6 shrink-0 items-center justify-center text-current">
            {props.space.kind === "private" ? <IconLock /> : <IconCube />}
          </span>
          <span className="min-w-0 flex-1 truncate">{props.space.name}</span>
        </SidebarMenuButton>
        <span className="absolute inset-y-0 right-0 flex items-center pr-1 transition-opacity duration-150 ease-out pointer-fine:opacity-0 pointer-fine:group-focus-within/space:opacity-100 pointer-fine:group-hover/space:opacity-100 pointer-fine:has-data-popup-open:opacity-100">
          {props.space.membershipId !== null ? (
            <Link
              to="/"
              search={{ spaceId: props.space.id }}
              aria-label={`New chat in ${props.space.name}`}
              className={buttonVariants({
                variant: "ghost",
                size: "icon-sm",
                className:
                  "text-sidebar-foreground/55 hover:bg-transparent hover:text-sidebar-foreground focus-visible:border-transparent focus-visible:ring-0 active:not-aria-[haspopup]:scale-100 aria-expanded:bg-transparent",
              })}
            >
              <IconPlus data-weight="heavy" />
            </Link>
          ) : null}
          <RowMenu
            side="right"
            className="text-sidebar-foreground/55 hover:bg-transparent hover:text-sidebar-foreground focus-visible:border-transparent focus-visible:ring-0 active:not-aria-[haspopup]:scale-100 aria-expanded:bg-transparent"
            label={`${props.space.name} actions`}
            items={[
              ...(isPersonal(props.space)
                ? []
                : [
                    props.pinned
                      ? { label: "Unpin", icon: IconPinnedOff, onSelect: () => props.onPin(false) }
                      : { label: "Pin", icon: IconPin, onSelect: () => props.onPin(true) },
                  ]),
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
      <RenameSpaceDialog space={props.space} open={renaming} onOpenChange={setRenaming} />
    </SidebarMenuItem>
  )
}

const days = { today: 0, week: 7, month: 30 } as const

const startOfDayAgo = (daysAgo: number) =>
  DateTime.toDateUtc(
    DateTime.startOf(
      DateTime.subtract(DateTime.makeZonedUnsafe(DateTime.nowUnsafe(), { timeZone: DateTime.zoneMakeLocal() }), {
        days: daysAgo,
      }),
      "day",
    ),
  ).toISOString()

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

const chatProperties = (
  spaces: ReadonlyArray<{ id: string; name: string; kind?: string | undefined }>,
): FilterProperty[] => [
  {
    key: "space",
    label: "Space",
    any: "All spaces",
    icon: IconCube,
    options: spaceOptions(spaces),
  },
  {
    key: "status",
    label: "Status",
    any: "Any",
    icon: IconActivity,
    options: [
      { value: "busy", label: "Working", icon: IconProgress },
      { value: "idle", label: "Idle", icon: IconCircle },
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
      { value: "today", label: "Today", icon: IconCalendarEvent },
      { value: "week", label: "Past 7 days", icon: IconCalendarWeek },
      { value: "month", label: "Past 30 days", icon: IconCalendarMonth },
    ],
  },
]

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
  const spaces = useSpaces().joined
  const defaults = Preference.usePreference(SidebarPreferences.chatFilters)
  const setPreference = Preference.useSetPreference()
  const [filters, setFilters] = useState<Filters>(defaults)
  return {
    filters,
    filtered: !sameFilters(filters, defaults),
    actions: (
      <FilterMenu
        label="Filter chats"
        trigger="sidebar"
        properties={chatProperties(spaces)}
        value={filters}
        onChange={setFilters}
        defaults={defaults}
        onSaveDefaults={() => setPreference(SidebarPreferences.chatFilters, filters)}
      />
    ),
  }
}

export function ChatsList(props: { path: string; filters: Filters; filtered: boolean }) {
  const { client } = RouterContext.useRouterContext()
  const me = useMe()
  const chatPages = useInfiniteQuery({
    ...sidebarSessionsOptions(client, chatFilter(props.filters, me.user.id)),
    placeholderData: keepPreviousData,
  })
  const chats = chatPages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <SidebarGroupContent className="pb-2">
      <SidebarMenu className={sidebarMenu}>
        {chatPages.isSuccess && chats.length === 0 ? (
          <li className="flex h-8 items-center pl-2.25 text-sm text-sidebar-foreground">
            {props.filtered ? "No chats match these filters" : "No chats yet"}
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
        {chatPages.isFetchingNextPage ? (
          <li>
            <output className="block px-2.25 py-2 text-sm text-muted-foreground">Loading more chats…</output>
          </li>
        ) : null}
      </SidebarMenu>
    </SidebarGroupContent>
  )
}

function UserRow() {
  const { auth, platform, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const me = useMe()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const organizations = useQuery({ ...organizationsOptions(auth), enabled: switcherOpen })
  const listed = organizations.data ?? []
  const allOrganizations = listed.some((organization) => organization.id === me.organization.id)
    ? listed
    : [me.organization, ...listed]
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
              className="group/user h-10 min-w-0 flex-1 gap-1.5 rounded-md py-1.5 pr-2 pl-1.5 group-data-[collapsible=icon]:justify-center hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
              tooltip={`${userName} · ${me.organization.name}`}
              aria-label={`Switch organization (current: ${me.organization.name})`}
            />
          }
        >
          <Avatar className="size-7">
            {me.user.image ? <AvatarImage src={me.user.image} alt="" /> : null}
            <AvatarFallback className="text-xs">{initials(userName)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col text-start leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium tracking-tight text-sidebar-foreground">{userName}</span>
            <span className="truncate text-xs text-sidebar-foreground/80">{me.organization.name}</span>
          </span>
          <IconSelector className="text-sidebar-foreground opacity-0 transition-opacity group-hover/user:opacity-100 group-focus-visible/user:opacity-100 group-data-popup-open/user:opacity-100 group-data-[collapsible=icon]:hidden" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={me.organization.id} onValueChange={(value: string) => void switchTo(value)}>
              {allOrganizations.map((organization) => (
                <DropdownMenuRadioItem key={organization.id} value={organization.id}>
                  <PersonAvatar name={organization.name} image={organization.logo ?? undefined} />
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
          await platform.chatCache?.forget()
          resetSession(queryClient)
          await navigate({ to: "/login" })
        }}
      />
    </>
  )
}

function HelpAndSettings() {
  const platform = Platform.usePlatform()
  return (
    <div className="flex shrink-0 group-data-[collapsible=icon]:hidden">
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
      <SidebarMenu className={sidebarMenu}>
        <NavRow
          to="/settings/preferences"
          label="Settings"
          icon={IconSettings}
          active={false}
          className="hidden group-data-[collapsible=icon]:block"
        />
        <SidebarMenuItem className="flex items-center gap-0.5">
          <UserRow />
          <HelpAndSettings />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
