import type { SpaceInfo } from "@ren/client"
import { cn } from "cn"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import {
  IconArrowLeft,
  IconBrain,
  IconBuildingFactory2,
  IconChartPie,
  IconMessagesFilled,
  IconChecklist,
  IconCube,
  IconFileText,
  IconFolder,
  IconInbox,
  IconKey,
  IconLayoutGridFilled,
  IconLock,
  IconSelector,
  IconSettings,
  IconShield,
  IconSparkles,
  IconCpu,
  IconUsers,
  IconWebhook,
} from "@tabler/icons-react"
import { GitMark } from "../icons/brands.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@ren/ui/sidebar"
import { Footer, Header, Section, sidebarMenu, sidebarRow } from "./sidebar-parts.js"
import { Preference } from "../lib/preference.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"
import { useSpaces } from "../lib/use-spaces.js"
import { RouterContext } from "../lib/router-context.js"
import { Seed } from "../lib/seed.js"

const spaceGroups = [
  {
    id: "work",
    label: "Work",
    items: [
      { value: "inbox", label: "Inbox", icon: IconInbox, to: "/spaces/$spaceId" },
      { value: "overview", label: "Overview", icon: IconChartPie, to: "/spaces/$spaceId/overview" },
      { value: "tasks", label: "Tasks", icon: IconChecklist, to: "/spaces/$spaceId/tasks" },
      { value: "drive", label: "Drive", icon: IconFolder, to: "/spaces/$spaceId/drive" },
      { value: "automations", label: "Automations", icon: IconWebhook, to: "/spaces/$spaceId/automations" },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    items: [
      { value: "agents", label: "Agents", icon: IconSparkles, to: "/spaces/$spaceId/agents" },
      { value: "factory", label: "Factory", icon: IconBuildingFactory2, to: "/spaces/$spaceId/factory" },
      { value: "instructions", label: "Instructions", icon: IconFileText, to: "/spaces/$spaceId/instructions" },
      { value: "memory", label: "Memory", icon: IconBrain, to: "/spaces/$spaceId/memory" },
      { value: "permissions", label: "Permissions", icon: IconShield, to: "/spaces/$spaceId/permissions" },
    ],
  },
  {
    id: "connections",
    label: "Connections",
    items: [
      { value: "apps", label: "Apps", icon: IconLayoutGridFilled, to: "/spaces/$spaceId/apps" },
      { value: "channels", label: "Channels", icon: IconMessagesFilled, to: "/spaces/$spaceId/channels" },
      { value: "credentials", label: "Secrets", icon: IconKey, to: "/spaces/$spaceId/credentials" },
      { value: "repositories", label: "Repositories", icon: GitMark, to: "/spaces/$spaceId/repositories" },
    ],
  },
  {
    id: "space",
    label: "Space",
    items: [
      { value: "compute", label: "Compute", icon: IconCpu, to: "/spaces/$spaceId/compute" },
      { value: "members", label: "Members", icon: IconUsers, to: "/spaces/$spaceId/members" },
      { value: "settings", label: "Settings", icon: IconSettings, to: "/spaces/$spaceId/settings" },
    ],
  },
] as const

type SpaceItem = (typeof spaceGroups)[number]["items"][number]

const shows = (item: SpaceItem, space: SpaceInfo | undefined) => item.value !== "members" || space?.kind !== "private"

function SpaceIcon(props: { kind: string; className?: string | undefined }) {
  return props.kind === "private" ? <IconLock className={props.className} /> : <IconCube className={props.className} />
}

function SpaceSwitcher(props: {
  spaceId: string
  space: SpaceInfo | undefined
  current: SpaceItem
  to: SpaceItem["to"]
}) {
  const navigate = useNavigate()
  const spaces = useSpaces().joined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            className={cn(
              sidebarRow,
              "font-medium text-sidebar-accent-foreground [&>svg:first-child]:text-sidebar-accent-foreground",
            )}
            tooltip={props.space?.name ?? "Switch space"}
            aria-label={`Switch space (current: ${props.space?.name ?? "Space"})`}
          />
        }
      >
        <SpaceIcon kind={props.space?.kind ?? "shared"} className="size-4.5" />
        <span className="flex-1 truncate">{props.space?.name ?? "Space"}</span>
        <IconSelector className="text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Spaces</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.spaceId}
            onValueChange={(spaceId: string) => {
              const target = spaces.find((each) => each.id === spaceId)
              void navigate({
                to: shows(props.current, target) ? props.to : "/spaces/$spaceId",
                params: { spaceId },
              })
            }}
          >
            {spaces.map((each) => (
              <DropdownMenuRadioItem key={each.id} value={each.id}>
                <SpaceIcon kind={each.kind} />
                {each.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SpaceNav(props: {
  label: string
  spaceId: string
  space: SpaceInfo | undefined
  items: ReadonlyArray<SpaceItem>
  current: SpaceItem
  closed?: boolean
}) {
  return (
    <SidebarMenu className={sidebarMenu} aria-label={props.label}>
      {props.items
        .filter((each) => shows(each, props.space))
        .map((each) => (
          <SidebarMenuItem
            key={each.value}
            className={cn(
              props.closed && props.current.value !== each.value && "hidden group-data-[collapsible=icon]:block",
            )}
          >
            <SidebarMenuButton
              className={sidebarRow}
              isActive={props.current.value === each.value}
              tooltip={each.label}
              render={<Link to={each.to} params={{ spaceId: props.spaceId }} />}
            >
              <each.icon />
              <span>{each.label}</span>
            </SidebarMenuButton>
            {each.value === "members" && props.space ? (
              <SidebarMenuBadge className="peer-data-[size=default]/menu-button:top-2">
                {props.space.memberCount}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
        ))}
    </SidebarMenu>
  )
}

export function SpaceSidebar(props: { spaceId: string; onSearch: () => void }) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const path = useLocation({ select: (location) => location.pathname })
  const space = useQuery({
    ...api.space.get.queryOptions({ idOrSlug: props.spaceId }),
    ...Seed.fromList<SpaceInfo>(queryClient, [api.space.list.queryKey()], props.spaceId),
  }).data
  const value = path.split("/").at(3)
  const current =
    spaceGroups.flatMap((group): ReadonlyArray<SpaceItem> => group.items).find((item) => item.value === value) ??
    spaceGroups[0].items[0]
  const open = Preference.usePreference(SidebarPreferences.spaceGroups)
  const setPreference = Preference.useSetPreference()
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-0 p-0">
        <Header onSearch={props.onSearch} />
        <SidebarMenu className={cn(sidebarMenu, "px-0.5")}>
          <SidebarMenuItem>
            <SidebarMenuButton className={sidebarRow} tooltip="All spaces" render={<Link to="/spaces" />}>
              <IconArrowLeft />
              <span>All spaces</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
            <SpaceSwitcher spaceId={props.spaceId} space={space} current={current} to={current.to} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="scrollbar-thin overflow-y-auto overscroll-contain">
        {spaceGroups.map((group) => (
          <Section
            key={group.id}
            label={group.label}
            open={open[group.id]}
            onToggle={() => setPreference(SidebarPreferences.spaceGroups, { ...open, [group.id]: !open[group.id] })}
            closed={
              <SpaceNav
                label={group.label}
                spaceId={props.spaceId}
                space={space}
                items={group.items}
                current={current}
                closed
              />
            }
            className="shrink-0 pt-4"
          >
            <SpaceNav label={group.label} spaceId={props.spaceId} space={space} items={group.items} current={current} />
          </Section>
        ))}
      </SidebarContent>
      <Footer />
      <SidebarRail />
    </Sidebar>
  )
}
