import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { ChannelsPage } from "../../../../../features/channels/channels-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/channels/")({
  head: () => ({ meta: [{ title: "Channels · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ q: Schema.optionalKey(Schema.String) })),
  loader: (options) => {
    const context = options.context
    return Promise.all([
      context.queryClient.query(
        context.api["channel-install"].list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
      ),
      context.queryClient.query(context.api["channel-connect"]["channel-provider"].list.queryOptions()),
    ])
  },
  component: ChannelsRoute,
})

function ChannelsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ChannelsPage
      query={search.q ?? ""}
      onQueryChange={(query) => void navigate({ search: query ? { q: query } : {}, replace: true })}
    />
  )
}
