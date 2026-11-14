import { createFileRoute } from "@tanstack/react-router"
import { SpaceArtifactsPage } from "../../../../../../features/drive/drive-artifacts.js"
import { DriveSearch } from "../../../../../../lib/drive-search.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/drive/artifacts")({
  head: () => ({ meta: [{ title: "Artifacts · Space · Ren" }] }),
  loader: (options) => DriveSearch.preloadArtifacts(options.context, { space: options.params.spaceId }),
  wrapInSuspense: false,
  component: SpaceArtifactsPage,
})
