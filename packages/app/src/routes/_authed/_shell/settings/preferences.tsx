import { createFileRoute } from "@tanstack/react-router"
import { PreferencesPage } from "../../../../features/account/preferences-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/preferences")({
  head: () => ({ meta: [{ title: "Preferences · Ren" }] }),
  component: PreferencesPage,
})
