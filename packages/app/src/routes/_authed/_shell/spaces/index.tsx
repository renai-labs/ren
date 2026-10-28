import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { SpacesPage, SpacesPending } from "../../../../features/spaces/spaces-page.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  head: () => ({ meta: [{ title: "Spaces · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
      ),
    )
  },
  pendingComponent: SpacesPending,
  component: SpacesRoute,
})

function SpacesRoute() {
  const context = Route.useRouteContext()
  return <SpacesPage userId={context.me.user.id} />
}
