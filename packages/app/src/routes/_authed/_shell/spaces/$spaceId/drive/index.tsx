import { createFileRoute } from "@tanstack/react-router"
import { SpaceDrivePage } from "../../../../../../features/drive/drive-page.js"
import { DriveSearch } from "../../../../../../lib/drive-search.js"
import { FolderSearch } from "../../../../../../lib/folder-search.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/drive/")({
  head: () => ({ meta: [{ title: "Drive · Space · Ren" }] }),
  validateSearch: FolderSearch.Search,
  loaderDeps: (options) => ({ folder: options.search.folder }),
  loader: (options) =>
    DriveSearch.preload(options.context, { space: options.params.spaceId, folder: options.deps.folder }),
  wrapInSuspense: false,
  component: SpaceDrivePage,
})
