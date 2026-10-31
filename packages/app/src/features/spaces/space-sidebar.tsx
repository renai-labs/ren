import { Pagination } from "@ren/schema/pagination"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import type { Glyph } from "@ren/ui/icon"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@ren/ui/sidebar"
import { IconCube, IconLock, IconSelector } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { SidebarItem, SidebarToggle } from "../../components/app-shell.js"
import { RouterContext } from "../../lib/router-context.js"
import { SpaceSections } from "./space-sections.js"

function SpaceIcon(props: { kind: string; className?: string }) {
  return props.kind === "private" ? <IconLock className={props.className} /> : <IconCube className={props.className} />
}

function SpaceSwitcher(props: {
  space: { id: string; name: string; kind: string } | undefined
  spaces: ReadonlyArray<{ id: string; name: string; kind: string }>
  onPick: (spaceId: string) => void
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="h-10"
              aria-label={`Switch space (current: ${props.space?.name ?? "loading"})`}
            />
          }
        >
          <SpaceIcon kind={props.space?.kind ?? "shared"} className="text-sidebar-accent-foreground" />
          <span className="flex-1 truncate text-sidebar-accent-foreground">{props.space?.name}</span>
          <IconSelector />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Spaces</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={props.space?.id ?? ""}
              onValueChange={(spaceId: string) => props.onPick(spaceId)}
            >
              {props.spaces.map((each) => (
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
  )
}

export function SpaceSidebar(props: { spaceId: string; footer: ReactNode }) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId })).data
  const spaces = useQuery(
    context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize, joined: true }),
  ).data?.items
  const current = SpaceSections.of(pathname)
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- shadcn's Sidebar renders a div and passes these to it
    <Sidebar variant="inset" collapsible="icon" role="complementary" aria-label="Space navigation">
      <SidebarHeader className="gap-1 px-0 pt-0">
        <div className="mb-2 flex h-7 items-center">
          <SidebarToggle />
        </div>
        <SidebarMenu>
          <SidebarItem label="All spaces" glyph="ArrowLeft" render={<Link to="/spaces" />} />
          <SpaceSwitcher
            space={space}
            spaces={spaces ?? []}
            onPick={(spaceId) => void navigate({ to: current.to, params: { spaceId } })}
          />
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {SpaceSections.all
                .filter((section) => section.value !== "members" || space?.kind !== "private")
                .map((section) => (
                  <SidebarItem
                    key={section.value}
                    label={section.label}
                    glyph={section.glyph satisfies Glyph}
                    isActive={current.value === section.value}
                    render={<Link to={section.to} params={{ spaceId: props.spaceId }} />}
                    trailing={
                      section.value === "members" && space ? (
                        <SidebarMenuBadge>{space.memberCount}</SidebarMenuBadge>
                      ) : undefined
                    }
                  />
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-0 pb-0">{props.footer}</SidebarFooter>
    </Sidebar>
  )
}
