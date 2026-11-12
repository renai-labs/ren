import { createFileRoute } from "@tanstack/react-router"
import { SpaceRepositoriesTab } from "../../../../../features/spaces/space-repositories.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/repositories")({
  head: () => ({ meta: [{ title: "Repositories · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["space-settings"].get.queryOptions({ idOrSlug: options.params.spaceId }),
      ),
    )
  },
  wrapInSuspense: false,
  component: SpaceRepositoriesTab,
})
