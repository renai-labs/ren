import type { SpaceInfo } from "@ren/client"
import { cn } from "cn"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import {
  IconApps,
  IconArrowLeft,
  IconMessagesFilled,
  IconBrowser,
  IconBuildingFactory2,
  IconClock,
  IconCube,
  IconKey,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconLock,
  IconSelector,
  IconSettings,
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@ren/ui/sidebar"
import { Footer, Header, sidebarRow } from "./sidebar-parts.js"
import { isSoftwareFactory } from "../lib/factory.js"
import { useSpaces } from "../lib/use-spaces.js"
import { RouterContext } from "../lib/router-context.js"
import { Seed } from "../lib/seed.js"

const spaceSections = [
  { value: "overview", label: "Overview", icon: IconLayoutDashboard, to: "/spaces/$spaceId" },
  { value: "kanban", label: "Kanban", icon: IconLayoutKanban, to: "/spaces/$spaceId/kanban" },
  { value: "artifacts", label: "Artifacts", icon: IconBrowser, to: "/spaces/$spaceId/artifacts" },
  { value: "settings", label: "Settings", icon: IconSettings, to: "/spaces/$spaceId/settings" },
  { value: "compute", label: "Compute", icon: IconCpu, to: "/spaces/$spaceId/compute" },
  { value: "members", label: "Members", icon: IconUsers, to: "/spaces/$spaceId/members" },
  { value: "apps", label: "Apps", icon: IconApps, to: "/spaces/$spaceId/apps" },
  { value: "repositories", label: "Repositories", icon: GitMark, to: "/spaces/$spaceId/repositories" },
  { value: "channels", label: "Channels", icon: IconMessagesFilled, to: "/spaces/$spaceId/channels" },
  { value: "credentials", label: "Keys", icon: IconKey, to: "/spaces/$spaceId/credentials" },
  { value: "schedules", label: "Scheduled", icon: IconClock, to: "/spaces/$spaceId/schedules" },
  { value: "webhooks", label: "Webhooks", icon: IconWebhook, to: "/spaces/$spaceId/webhooks" },
  { value: "factory", label: "Factory", icon: IconBuildingFactory2, to: "/spaces/$spaceId/factory" },
] as const

type SpaceSection = (typeof spaceSections)[number]["value"]

const spaceSectionOf = (path: string): SpaceSection =>
  spaceSections.find((section) => section.value === path.split("/").at(3))?.value ?? "overview"

function SpaceIcon(props: { kind: string; className?: string | undefined }) {
  return props.kind === "private" ? <IconLock className={props.className} /> : <IconCube className={props.className} />
}

function SpaceSwitcher(props: {
  spaceId: string
  space: SpaceInfo | undefined
  section: (typeof spaceSections)[number]
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
              const factoryOnly =
                (props.section.value === "kanban" || props.section.value === "overview") &&
                !(target && isSoftwareFactory(target))
              void navigate({ to: factoryOnly ? "/spaces/$spaceId" : props.section.to, params: { spaceId } })
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

function SpaceNav(props: { spaceId: string; space: SpaceInfo | undefined; current: SpaceSection }) {
  const factory = props.space !== undefined && isSoftwareFactory(props.space)
  return (
    <SidebarMenu className="gap-1">
      {spaceSections
        .filter((each) => each.value !== "members" || props.space?.kind !== "private")
        .filter((each) => factory || (each.value !== "kanban" && each.value !== "overview"))
        .map((each) => (
          <SidebarMenuItem key={each.value}>
            <SidebarMenuButton
              className={sidebarRow}
              isActive={props.current === each.value}
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
  const current = spaceSectionOf(path)
  const section = spaceSections.find((each) => each.value === current) ?? spaceSections[0]
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-0 p-0">
        <Header onSearch={props.onSearch} />
        <SidebarMenu className="gap-1 px-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton className={sidebarRow} tooltip="All spaces" render={<Link to="/spaces" />}>
              <IconArrowLeft />
              <span>All spaces</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
            <SpaceSwitcher spaceId={props.spaceId} space={space} section={section} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-0.5 pt-5 group-data-[collapsible=icon]:pt-3">
          <SidebarGroupContent>
            <SpaceNav spaceId={props.spaceId} space={space} current={current} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <Footer />
      <SidebarRail />
    </Sidebar>
  )
}
