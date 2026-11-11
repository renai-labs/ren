import { createFileRoute, redirect } from "@tanstack/react-router"
import { AppsPage } from "../../../../features/apps/apps-page.js"
import { pageSize, currentPage } from "../../../../lib/pagination.js"
import { Loader } from "../../../../lib/loader.js"
import { Routing } from "../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/apps/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  validateSearch: Routing.AppSearch,
  beforeLoad: (options) => {
    if (options.search.app) throw redirect({ to: "/apps/$appId", params: { appId: options.search.app }, replace: true })
  },
  loaderDeps: (options) => ({ page: currentPage(options.search) }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["app-registry"].list.queryOptions({ page: options.deps.page, pageSize }),
      ),
    )
  },
  component: AppsPage,
})
