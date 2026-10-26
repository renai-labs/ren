export * as SettingsPages from "./settings-pages.js"

import type { Glyph } from "@ren/ui/icon"

export type Page = {
  label: string
  to:
    | "/settings/preferences"
    | "/settings/credentials"
    | "/settings/general"
    | "/settings/members"
    | "/settings/providers"
  glyph: Glyph
}

export const personal: ReadonlyArray<Page> = [
  { label: "Preferences", to: "/settings/preferences", glyph: "Sliders" },
  { label: "Credentials", to: "/settings/credentials", glyph: "KeyRound" },
]

export const organization: ReadonlyArray<Page> = [
  { label: "General", to: "/settings/general", glyph: "Building" },
  { label: "Members", to: "/settings/members", glyph: "Users" },
  { label: "Providers", to: "/settings/providers", glyph: "Server" },
]
