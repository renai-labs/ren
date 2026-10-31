import { Pagination } from "@ren/schema/pagination"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@ren/ui/sidebar"
import { IconChevronRight, IconCube, IconLock } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import { Pathname } from "@ren/util/pathname"
import { RouterContext } from "../../lib/router-context.js"

export function SpacesNav() {
  const context = RouterContext.useRouterContext()
  const pathname = useRouterState({ select: (state) => Pathname.trimTrailingSlashes(state.location.pathname) })
  const sidebar = useSidebar()
  const spaces = useQuery(
    context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize, joined: true }),
  )
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <SidebarMenuButton
        tooltip="Spaces"
        isActive={pathname === "/spaces"}
        onClick={() => sidebar.setOpenMobile(false)}
        render={<Link to="/spaces" />}
      >
        <IconCube />
        <span>Spaces</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        render={<CollapsibleTrigger />}
        aria-label={open ? "Collapse spaces" : "Expand spaces"}
        className="aria-expanded:[&>svg]:rotate-90"
      >
        <IconChevronRight className="transition-transform duration-150 ease-out" />
      </SidebarMenuAction>
      <CollapsibleContent>
        <SidebarMenuSub className="mr-0 pr-0">
          {(spaces.data?.items ?? []).map((space) => (
            <SidebarMenuSubItem key={space.id}>
              <SidebarMenuSubButton
                isActive={pathname.startsWith(`/spaces/${space.id}`)}
                onClick={() => sidebar.setOpenMobile(false)}
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
