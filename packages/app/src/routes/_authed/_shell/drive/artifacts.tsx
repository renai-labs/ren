import { createFileRoute } from "@tanstack/react-router"
import { ArtifactsPage } from "../../../../features/drive/drive-artifacts.js"
import { DriveSearch } from "../../../../lib/drive-search.js"

export const Route = createFileRoute("/_authed/_shell/drive/artifacts")({
  head: () => ({ meta: [{ title: "Artifacts · Drive · Ren" }] }),
  validateSearch: DriveSearch.ArtifactsSearch,
  loaderDeps: (options) => ({ space: options.search.space }),
  loader: (options) => DriveSearch.preloadArtifacts(options.context, options.deps),
  component: ArtifactsPage,
})
