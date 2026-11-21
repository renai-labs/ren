import { createFileRoute } from "@tanstack/react-router"
import { PermissionsSettingsPage } from "../../../../../features/organization/permissions-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/permissions")({
  head: () => ({ meta: [{ title: "Permissions · Ren" }] }),
  component: PermissionsSettingsPage,
})
