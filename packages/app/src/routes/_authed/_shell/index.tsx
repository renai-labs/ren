import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { HomePage } from "../../../features/session/home-page.js"
import { pickerPageSize } from "../../../lib/pagination.js"
import { ChatQueries } from "../../../lib/chat-queries.js"
import { Loader } from "../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/")({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ spaceId: Schema.optional(Schema.String) })),
  head: () => ({ meta: [{ title: "New chat · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
      ),
      ...ChatQueries.start(options.context, options.context.me.organization?.id),
    )
  },
  component: HomeRoute,
})

function HomeRoute() {
  const search = Route.useSearch()
  return <HomePage key={search.spaceId} />
}
