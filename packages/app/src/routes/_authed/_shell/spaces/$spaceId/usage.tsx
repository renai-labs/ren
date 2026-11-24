import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceUsageTab } from "../../../../../features/usage/usage-pages.js"
import { UsageQuery } from "../../../../../features/usage/usage-query.js"
import { UsageSearch } from "../../../../../features/usage/usage-search.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/usage")({
  head: () => ({ meta: [{ title: "Usage · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(UsageSearch.Search),
  loaderDeps: (options) => ({ search: options.search }),
  loader: (options) => {
    Loader.start(
      ...UsageQuery.all({ spaceId: options.params.spaceId }, options.deps.search, Date.now()).map((input) =>
        options.context.queryClient.query(options.context.api.insights.query.queryOptions(input)),
      ),
    )
  },
  wrapInSuspense: false,
  component: Usage,
})

function Usage() {
  const spaceId = Route.useParams().spaceId
  return <SpaceUsageTab key={spaceId} spaceId={spaceId} />
}
