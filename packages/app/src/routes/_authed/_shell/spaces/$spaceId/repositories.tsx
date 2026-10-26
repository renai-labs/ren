import { createFileRoute } from "@tanstack/react-router"
import { SpaceRepositories } from "../../../../../features/spaces/space-repositories.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/repositories")({
  head: () => ({ meta: [{ title: "Space repositories · Ren" }] }),
  loader: (options) =>
    options.context.queryClient.query(
      options.context.api["space-settings"].get.queryOptions({ idOrSlug: options.params.spaceId }),
    ),
  component: SpaceRepositoriesRoute,
})

function SpaceRepositoriesRoute() {
  const params = Route.useParams()
  return <SpaceRepositories spaceId={params.spaceId} />
}
