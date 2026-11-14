import { createFileRoute } from "@tanstack/react-router"
import { SpaceFiles } from "../../../../../features/spaces/space-files.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/memory")({
  head: () => ({ meta: [{ title: "Memory · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.files.list.queryOptions({ source: "memory", spaceId: options.params.spaceId }),
      ),
    )
  },
  wrapInSuspense: false,
  component: () => <SpaceFiles source="memory" />,
})
