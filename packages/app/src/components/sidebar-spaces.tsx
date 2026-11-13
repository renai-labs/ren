import { useState } from "react"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"
import { cn } from "cn"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@ren/ui/sidebar"
import { Preference } from "../lib/preference.js"
import { NewSpaceDialog } from "./new-space-dialog.js"
import { SpaceEntry, sidebarRow } from "./sidebar-parts.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"
import { useSpaces } from "../lib/use-spaces.js"

const shownSpaces = 3

export function SpacesList(props: { path: string }) {
  const spaces = useSpaces().joined
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState(false)
  const pinned = Preference.usePreference(SidebarPreferences.pinned)
  const setPreference = Preference.useSetPreference()
  const pin = (spaceId: string, options: { on: boolean }) => {
    const next = options.on
      ? [...pinned.filter((id) => id !== spaceId), spaceId]
      : pinned.filter((id) => id !== spaceId)
    setPreference(SidebarPreferences.pinned, next)
  }
  const pinnedSpaces = pinned.flatMap((id) => spaces.filter((space) => space.id === id))
  const ordered = [...pinnedSpaces, ...spaces.filter((space) => !pinned.includes(space.id))]
  const visible = Math.max(shownSpaces, pinnedSpaces.length)
  const rest = ordered.length - visible
  return (
    <section aria-label="Sidebar spaces">
      <SidebarMenu className="gap-px">
        {ordered.slice(0, open ? undefined : visible).map((space) => (
          <SpaceEntry
            key={space.id}
            space={space}
            path={props.path}
            pinned={pinned.includes(space.id)}
            onPin={(on) => pin(space.id, { on })}
          />
        ))}
        {rest > 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(sidebarRow, "gap-2 text-sidebar-foreground/70")}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <IconChevronDown
                  className={cn(
                    "transition-transform duration-150 ease-out motion-reduce:transition-none",
                    open && "rotate-180",
                  )}
                />
              </span>
              <span>{open ? "Show less" : `${rest} more`}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
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
