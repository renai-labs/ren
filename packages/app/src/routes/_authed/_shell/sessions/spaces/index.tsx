import { createFileRoute } from "@tanstack/react-router"
import { SpacesPage } from "../../../../../features/spaces/spaces-page.js"
import { Auth } from "../../../../../lib/auth.js"

export const Route = createFileRoute("/_authed/_shell/sessions/spaces/")({
  head: () => ({ meta: [{ title: "Spaces · Ren" }] }),
  loader: (options) =>
    Promise.all([
      options.context.queryClient.query(options.context.api.space.list.queryOptions({ page: 1, pageSize: 100 })),
      options.context.queryClient.query(Auth.activeRoleOptions(options.context.auth)),
    ]),
  component: SpacesRoute,
})

function SpacesRoute() {
  const context = Route.useRouteContext()
  return <SpacesPage userId={context.me.user.id} />
}
