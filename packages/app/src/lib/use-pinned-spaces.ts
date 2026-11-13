import type { SpaceInfo } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { Preference } from "./preference.js"
import { SidebarPreferences } from "./sidebar-preferences.js"
import { useSpaces } from "./use-spaces.js"

const maxPinned = 3

export const isPersonal = (space: SpaceInfo) => space.kind === "private" && space.membershipId !== null

export function usePinnedSpaces() {
  const spaces = useSpaces().joined
  const stored = Preference.usePreference(SidebarPreferences.pinned)
  const setPreference = Preference.useSetPreference()
  const pinned = stored
    .flatMap((id) => spaces.filter((space) => space.id === id && !isPersonal(space)))
    .slice(0, maxPinned)
    .map((space) => space.id)
  const top = [...spaces.filter(isPersonal).map((space) => space.id), ...pinned]
  return {
    top: top.length,
    isPinned: (spaceId: string) => top.includes(spaceId),
    order: <A extends { readonly id: string }>(list: ReadonlyArray<A>) => [
      ...top.flatMap((id) => list.filter((space) => space.id === id)),
      ...list.filter((space) => !top.includes(space.id)),
    ],
    pin: (space: SpaceInfo, options: { on: boolean }) => {
      if (options.on && pinned.length >= maxPinned)
        return void toast.error(`You can pin up to ${maxPinned} spaces`, { description: "Unpin one to pin another." })
      setPreference(
        SidebarPreferences.pinned,
        options.on ? [...pinned, space.id] : pinned.filter((id) => id !== space.id),
      )
    },
  }
}
