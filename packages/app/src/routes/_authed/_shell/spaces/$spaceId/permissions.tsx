import { createFileRoute } from "@tanstack/react-router"
import { SpacePermissionsTab } from "../../../../../features/spaces/space-permissions.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/permissions")({
  head: () => ({ meta: [{ title: "Permissions · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["space-settings"].get.queryOptions({ idOrSlug: options.params.spaceId }),
      ),
    )
  },
  wrapInSuspense: false,
  component: SpacePermissionsTab,
})
