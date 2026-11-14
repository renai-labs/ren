import { createFileRoute } from "@tanstack/react-router"
import { SpaceFiles } from "../../../../../features/spaces/space-files.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/drive")({
  head: () => ({ meta: [{ title: "Drive · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.files.list.queryOptions({ source: "drive", spaceId: options.params.spaceId }),
      ),
    )
  },
  wrapInSuspense: false,
  component: () => <SpaceFiles source="drive" />,
})
