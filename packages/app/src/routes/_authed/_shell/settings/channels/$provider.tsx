import { Channel } from "@ren/schema/channel"
import { Pagination } from "@ren/schema/pagination"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { Schema } from "effect"
import { ChannelProviderPage } from "../../../../../features/channels/channel-provider-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/channels/$provider")({
  head: () => ({ meta: [{ title: "Channels · Ren" }] }),
  params: {
    parse: (params) => {
      if (!Schema.is(Channel.Provider)(params.provider)) throw notFound()
      return { provider: params.provider }
    },
  },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ installed: Schema.optionalKey(Schema.String), error: Schema.optionalKey(Schema.String) }),
  ),
  loader: (options) => {
    const context = options.context
    return context.queryClient.query(
      context.api["channel-install"].list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
    )
  },
  component: ChannelProviderRoute,
})

function ChannelProviderRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  return <ChannelProviderPage provider={params.provider} installed={search.installed} error={search.error} />
}
