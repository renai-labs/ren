import { createFileRoute } from "@tanstack/react-router"
import { MemorySettingsPage } from "../../../../features/organization/memory-page.js"
import { FolderSearch } from "../../../../lib/folder-search.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/memory")({
  head: () => ({ meta: [{ title: "Memory · Ren" }] }),
  validateSearch: FolderSearch.Search,
  loaderDeps: (options) => ({ folder: options.search.folder }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.files.list.queryOptions({
          source: "memory",
          ...(options.deps.folder && { folder: options.deps.folder }),
        }),
      ),
    )
  },
  wrapInSuspense: false,
  component: MemorySettingsPage,
})
