import { createFileRoute } from "@tanstack/react-router"
import { ArtifactsPage } from "../../../features/artifacts/artifacts-page.js"
import { Artifacts } from "../../../lib/artifacts.js"
import { Loader } from "../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/artifacts")({
  head: () => ({ meta: [{ title: "Artifacts · Ren" }] }),
  validateSearch: Artifacts.Search,
  loader: (options) => {
    Loader.start(options.context.queryClient.query(Artifacts.allOptions(options.context.client)))
  },
  component: ArtifactsPage,
})
