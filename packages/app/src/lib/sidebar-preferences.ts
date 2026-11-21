export * as SidebarPreferences from "./sidebar-preferences.js"

import { Schema } from "effect"
import { Preference } from "./preference.js"

export const open = Preference.make("sidebar.open.v1", Schema.Boolean, true)

export const sections = Preference.make(
  "sidebar.sections.v1",
  Schema.Struct({ spaces: Schema.Boolean, chats: Schema.Boolean }),
  { spaces: true, chats: true },
)

export const spaceGroups = Preference.make(
  "sidebar.space-groups.v1",
  Schema.Struct({
    work: Schema.Boolean,
    agents: Schema.Boolean,
    connections: Schema.Boolean,
    space: Schema.Boolean,
  }),
  { work: true, agents: false, connections: false, space: false },
)

export const chatFilters = Preference.make(
  "sidebar.chat-filters.v1",
  Schema.Record(Schema.String, Schema.mutable(Schema.Array(Schema.String))),
  { origin: ["chat"] },
)

export const pinned = Preference.make("sidebar.pinned.v1", Schema.Array(Schema.String), [])
