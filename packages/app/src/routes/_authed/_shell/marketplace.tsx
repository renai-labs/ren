import { createFileRoute } from "@tanstack/react-router"
import { MarketplacePage } from "../../../features/apps/marketplace-page.js"
import { pageSize, currentPage } from "../../../lib/pagination.js"
import { Loader } from "../../../lib/loader.js"
import { Routing } from "../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/marketplace")({
  head: () => ({ meta: [{ title: "Marketplace · Ren" }] }),
  validateSearch: Routing.AppSearch,
  loaderDeps: (options) => ({ page: currentPage(options.search) }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["app-registry"].list.queryOptions({ page: options.deps.page, pageSize }),
      ),
    )
  },
  component: MarketplacePage,
})
