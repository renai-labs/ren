import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppCategories } from "../../../../features/apps/app-categories.js"
import { AppsPage } from "../../../../features/apps/apps-page.js"
import { AppRegistryPages } from "../../../../lib/app-registry.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/apps/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      app: Schema.optional(Schema.String),
      category: Schema.optional(Schema.String),
      tab: Schema.optional(Schema.Literals(["organization", "installed"])),
    }),
  ),
  beforeLoad: (options) => {
    if (options.search.app) throw redirect({ to: "/apps/$appId", params: { appId: options.search.app }, replace: true })
  },
  loaderDeps: (options) => ({ category: options.search.category, tab: options.search.tab }),
  loader: (options) => {
    const context = options.context
    const category = options.deps.category
    const featured = category ? AppCategories.find(category).apps : AppCategories.featured
    if (category)
      Loader.start(context.queryClient.infiniteQuery(AppRegistryPages.options(context.client, "", category)))
    if (featured.length > 0 && (category || !options.deps.tab))
      Loader.start(context.queryClient.query(AppRegistryPages.bySlugs(context.api, featured)))
  },
  component: AppsPage,
})
