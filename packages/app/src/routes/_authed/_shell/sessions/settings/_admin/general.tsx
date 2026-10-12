import { createFileRoute } from "@tanstack/react-router"
import { GeneralSettings } from "../../../../../../features/organization/general-settings.js"

export const Route = createFileRoute("/_authed/_shell/sessions/settings/_admin/general")({
  head: () => ({ meta: [{ title: "General · Ren" }] }),
  component: GeneralPage,
})

function GeneralPage() {
  const context = Route.useRouteContext()
  const organization = context.me.organization
  if (organization === null) return null
  return <GeneralSettings key={organization.id} organizationId={organization.id} />
}
