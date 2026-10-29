import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import {
  IconApps,
  IconArrowLeft,
  IconAt,
  IconBuildingFactory2,
  IconClock,
  IconCube,
  IconGitBranch,
  IconKey,
  IconLayoutDashboard,
  IconLock,
  IconSelector,
  IconUsers,
} from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { sidebarRow } from "@/components/ren/app-sidebar"
import { useSpaces } from "@/hooks/use-spaces"
import { api } from "@/lib/api"

const spaceSections = [
  { value: "overview", label: "Overview", icon: IconLayoutDashboard, to: "/spaces/$spaceId" },
  { value: "members", label: "Members", icon: IconUsers, to: "/spaces/$spaceId/members" },
  { value: "apps", label: "Apps", icon: IconApps, to: "/spaces/$spaceId/apps" },
  { value: "repositories", label: "Repositories", icon: IconGitBranch, to: "/spaces/$spaceId/repositories" },
  { value: "channels", label: "Mentions", icon: IconAt, to: "/spaces/$spaceId/channels" },
  { value: "credentials", label: "Keys", icon: IconKey, to: "/spaces/$spaceId/credentials" },
  { value: "schedules", label: "Scheduled", icon: IconClock, to: "/spaces/$spaceId/schedules" },
  { value: "factory", label: "Factory", icon: IconBuildingFactory2, to: "/spaces/$spaceId/factory" },
] as const

type SpaceSection = (typeof spaceSections)[number]["value"]

const spaceSectionOf = (path: string): SpaceSection =>
  spaceSections.find((section) => section.value === path.split("/").at(3))?.value ?? "overview"

function SpaceIcon(props: { kind: string; className?: string | undefined }) {
  return props.kind === "private" ? <IconLock className={props.className} /> : <IconCube className={props.className} />
}

export function SpaceSidebar(props: { spaceId: string }) {
  const path = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const space = useSuspenseQuery(api.space.get.queryOptions({ idOrSlug: props.spaceId })).data
  const spaces = useSpaces().spaces
  const current = spaceSectionOf(path)
  const section = spaceSections.find((each) => each.value === current) ?? spaceSections[0]
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="gap-1 px-0 pt-0">
        <div className="mb-2 flex h-7 items-center">
          <SidebarTrigger />
        </div>
        <SidebarMenu className="gap-px">
          <SidebarMenuItem>
            <SidebarMenuButton className={sidebarRow} render={<Link to="/" />}>
              <IconArrowLeft />
              <span>Back to app</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton size="lg" className="h-10" aria-label={`Switch space (current: ${space.name})`} />
                }
              >
                <span className="flex size-6 items-center justify-center rounded-md bg-sidebar-accent">
                  <SpaceIcon kind={space.kind} className="size-3.5 text-sidebar-accent-foreground" />
                </span>
                <span className="flex-1 truncate font-medium text-sidebar-accent-foreground">{space.name}</span>
                <IconSelector className="text-sidebar-foreground/70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Spaces</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={space.id}
                    onValueChange={(spaceId: string) => void navigate({ to: section.to, params: { spaceId } })}
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
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {spaceSections
                .filter((each) => each.value !== "members" || space.kind !== "private")
                .map((each) => (
                  <SidebarMenuItem key={each.value}>
                    <SidebarMenuButton
                      className={sidebarRow}
                      isActive={current === each.value}
                      render={<Link to={each.to} params={{ spaceId: props.spaceId }} />}
                    >
                      <each.icon />
                      <span>{each.label}</span>
                    </SidebarMenuButton>
                    {each.value === "members" ? (
                      <SidebarMenuBadge className="peer-data-[size=default]/menu-button:top-1.5">
                        {space.memberCount}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
