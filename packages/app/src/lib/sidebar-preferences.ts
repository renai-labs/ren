export * as SidebarPreferences from "./sidebar-preferences.js"

import { Schema } from "effect"
import { Preference } from "./preference.js"

export const open = Preference.make("sidebar.open.v1", Schema.Boolean, true)

export const sections = Preference.make(
  "sidebar.sections.v1",
  Schema.Struct({ spaces: Schema.Boolean, chats: Schema.Boolean }),
  { spaces: true, chats: true },
)

export const pinned = Preference.make("sidebar.pinned.v1", Schema.Array(Schema.String), [])
