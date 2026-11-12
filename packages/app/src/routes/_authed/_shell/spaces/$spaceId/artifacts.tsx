import { createFileRoute } from "@tanstack/react-router"
import { SpaceArtifactsTab } from "../../../../../features/spaces/space-artifacts.js"
import { Artifacts } from "../../../../../lib/artifacts.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/artifacts")({
  head: () => ({ meta: [{ title: "Artifacts · Space · Ren" }] }),
  validateSearch: Artifacts.Search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(Artifacts.allOptions(options.context.client, options.params.spaceId)),
    )
  },
  wrapInSuspense: false,
  component: SpaceArtifactsTab,
})
