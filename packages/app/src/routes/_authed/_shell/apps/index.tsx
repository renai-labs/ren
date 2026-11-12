import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppsPage } from "../../../../features/apps/apps-page.js"
import { AppRegistryPages } from "../../../../lib/app-registry.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/apps/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ app: Schema.optional(Schema.String), category: Schema.optional(Schema.String) }),
  ),
  beforeLoad: (options) => {
    if (options.search.app) throw redirect({ to: "/apps/$appId", params: { appId: options.search.app }, replace: true })
  },
  loaderDeps: (options) => ({ category: options.search.category }),
  loader: (options) => {
    const client = options.context.client
    Loader.start(
      options.context.queryClient.infiniteQuery(AppRegistryPages.options(client, "")),
      ...(options.deps.category
        ? [options.context.queryClient.infiniteQuery(AppRegistryPages.options(client, "", options.deps.category))]
        : []),
    )
  },
  component: AppsPage,
})
