import { createFileRoute } from "@tanstack/react-router"
import { SpaceMemory } from "../../../../../features/spaces/space-memory.js"
import { FolderSearch } from "../../../../../lib/folder-search.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/memory")({
  head: () => ({ meta: [{ title: "Memory · Space · Ren" }] }),
  validateSearch: FolderSearch.Search,
  loaderDeps: (options) => ({ folder: options.search.folder }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.files.list.queryOptions({
          source: "memory",
          spaceId: options.params.spaceId,
          ...(options.deps.folder && { folder: options.deps.folder }),
        }),
      ),
    )
  },
  wrapInSuspense: false,
  component: SpaceMemory,
})
