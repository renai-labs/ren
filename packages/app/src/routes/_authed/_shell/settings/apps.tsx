import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { AppsPage } from "../../../../features/apps/apps-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/apps")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  loader: (options) => {
    const context = options.context
    const page = { page: 1, pageSize: Pagination.maximumPageSize }
    return Promise.all([
      context.queryClient.query(context.api.app.list.queryOptions(page)),
      context.queryClient.query(context.api["app-profile"].list.queryOptions(page)),
    ])
  },
  component: AppsPage,
})
