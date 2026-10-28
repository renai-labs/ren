import { Page } from "@ren/ui/page"
import { createFileRoute } from "@tanstack/react-router"
import { SpaceRepositories } from "../../../../../features/spaces/space-repositories.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/repositories")({
  head: () => ({ meta: [{ title: "Space repositories · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["space-settings"].get.queryOptions({ idOrSlug: options.params.spaceId }),
      ),
    )
  },
  pendingComponent: () => <Page.Skeletons body="rows" />,
  component: SpaceRepositoriesRoute,
})

function SpaceRepositoriesRoute() {
  const params = Route.useParams()
  return <SpaceRepositories spaceId={params.spaceId} />
}
