import { useState } from "react"
import { IconPlus } from "@tabler/icons-react"
import { cn } from "cn"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@ren/ui/sidebar"
import { NewSpaceDialog } from "./new-space-dialog.js"
import { SpaceEntry, sidebarMenu, sidebarRow } from "./sidebar-parts.js"
import { usePinnedSpaces } from "../lib/use-pinned-spaces.js"
import { useSpaces } from "../lib/use-spaces.js"

const shownSpaces = 3

export function SpacesList(props: { path: string }) {
  const spaces = useSpaces().joined
  const pins = usePinnedSpaces()
  const [creating, setCreating] = useState(false)
  return (
    <section aria-label="Sidebar spaces">
      <SidebarMenu className={sidebarMenu}>
        {pins
          .order(spaces)
          .slice(0, Math.max(shownSpaces, pins.top))
          .map((space) => (
            <SpaceEntry
              key={space.id}
              space={space}
              path={props.path}
              pinned={pins.isPinned(space.id)}
              onPin={(on) => pins.pin(space, { on })}
            />
          ))}
        {spaces.length === 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton className={cn(sidebarRow, "text-sidebar-foreground")} onClick={() => setCreating(true)}>
              <IconPlus />
              <span>Add space</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
      <NewSpaceDialog open={creating} onOpenChange={setCreating} />
    </section>
  )
}
