import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { OrganizationUsagePage } from "../../../../../features/usage/usage-pages.js"
import { UsageQuery } from "../../../../../features/usage/usage-query.js"
import { UsageSearch } from "../../../../../features/usage/usage-search.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/usage")({
  head: () => ({ meta: [{ title: "Usage · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(UsageSearch.Search),
  loaderDeps: (options) => ({ search: options.search }),
  loader: (options) => {
    Loader.start(
      ...Object.values(UsageQuery.inputs({}, options.deps.search, Date.now())).map((input) =>
        options.context.queryClient.query(options.context.api.insights.query.queryOptions(input)),
      ),
      options.context.queryClient.query(options.context.api.billing.get.queryOptions()),
      options.context.queryClient.query(options.context.api["ren-inference"].connection.list.queryOptions()),
    )
  },
  component: OrganizationUsagePage,
})
