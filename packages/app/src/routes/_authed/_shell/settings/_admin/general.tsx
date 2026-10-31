import { createFileRoute } from "@tanstack/react-router"
import { GeneralSettingsPage } from "../../../../../features/organization/general-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/general")({
  head: () => ({ meta: [{ title: "General · Ren" }] }),
  component: GeneralSettingsPage,
})
