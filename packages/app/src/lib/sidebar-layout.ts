export * as SidebarLayout from "./sidebar-layout.js"

import { useSyncExternalStore } from "react"
import { Schema } from "effect"
import type { Platform } from "../platform/platform.js"
import { Preference } from "./preference.js"

const preference = Preference.make("sidebar.group-chats.v1", Schema.Boolean, false)

const listeners = new Set<() => void>()

// oxlint-disable-next-line ren/no-comments -- Whether the sidebar groups chats by space. Settings change it, and every sidebar follows at once.
export function useGrouped(storage: Platform.Storage) {
  const grouped = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => preference.read(storage),
  )
  return {
    grouped,
    set: (next: boolean) => {
      preference.write(storage, next)
      for (const listener of listeners) listener()
    },
  }
}
