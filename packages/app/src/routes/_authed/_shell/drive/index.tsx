import { createFileRoute } from "@tanstack/react-router"
import { DrivePage } from "../../../../features/drive/drive-page.js"
import { DriveSearch } from "../../../../lib/drive-search.js"

export const Route = createFileRoute("/_authed/_shell/drive/")({
  head: () => ({ meta: [{ title: "Drive · Ren" }] }),
  validateSearch: DriveSearch.Search,
  loaderDeps: (options) => ({ space: options.search.space, folder: options.search.folder }),
  loader: (options) => DriveSearch.preload(options.context, options.deps),
  component: DrivePage,
})
