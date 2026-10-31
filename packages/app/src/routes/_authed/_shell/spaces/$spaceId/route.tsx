import { createFileRoute } from "@tanstack/react-router"
import { SpaceLayout } from "../../../../../features/spaces/space-page.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId")({
  head: () => ({ meta: [{ title: "Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.space.get.queryOptions({ idOrSlug: options.params.spaceId }),
      ),
    )
  },
  component: SpaceLayout,
})
