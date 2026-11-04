import { createFileRoute } from "@tanstack/react-router"
import { SpacesPage } from "../../../../features/spaces/spaces-page.js"
import { pageSize, currentPage } from "../../../../lib/pagination.js"
import { Loader } from "../../../../lib/loader.js"
import { Routing } from "../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  head: () => ({ meta: [{ title: "Spaces · Ren" }] }),
  validateSearch: Routing.PageSearch,
  loaderDeps: (options) => ({ page: currentPage(options.search) }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: options.deps.page, pageSize }),
      ),
    )
  },
  component: SpacesPage,
})
