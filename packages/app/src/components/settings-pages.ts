export * as SettingsPages from "./settings-pages.js"

import type { Glyph } from "@ren/ui/icon"

export type Page = {
  label: string
  to: "/sessions/settings/preferences" | "/sessions/settings/general" | "/sessions/settings/members"
  glyph: Glyph
}

export const personal: ReadonlyArray<Page> = [
  { label: "Preferences", to: "/sessions/settings/preferences", glyph: "Sliders" },
]

export const organization: ReadonlyArray<Page> = [
  { label: "General", to: "/sessions/settings/general", glyph: "Building" },
  { label: "Members", to: "/sessions/settings/members", glyph: "Users" },
]
