import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Preferences } from "../../../../features/account/preferences.js"

export const Route = createFileRoute("/_authed/_shell/settings/preferences")({
  head: () => ({ meta: [{ title: "Preferences · Ren" }] }),
  component: PreferencesPage,
})

function PreferencesPage() {
  const context = Route.useRouteContext()
  const me = useQuery(context.api.me.get.queryOptions())
  const user = me.data?.user ?? context.me.user
  const organization = me.data?.organization ?? context.me.organization
  return <Preferences key={user.id} user={user} organization={organization} />
}
