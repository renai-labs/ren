import { createFileRoute } from "@tanstack/react-router"
import { SpaceRepositoriesTab } from "../../../../../features/spaces/space-repositories.js"
import { Loader } from "../../../../../lib/loader.js"
import { Routing } from "../../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/repositories")({
  head: () => ({ meta: [{ title: "Repositories · Space · Ren" }] }),
  validateSearch: Routing.PageSearch,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["space-settings"].get.queryOptions({ idOrSlug: options.params.spaceId }),
      ),
    )
  },
  component: SpaceRepositoriesTab,
})
