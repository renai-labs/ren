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
  return <Preferences key={user.id} user={user} />
}
