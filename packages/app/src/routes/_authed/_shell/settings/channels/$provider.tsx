import { Channel } from "@ren/schema/channel"
import { Pagination } from "@ren/schema/pagination"
import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { ChannelProviderPage } from "../../../../../features/channels/channel-provider-page.js"
import { Channels } from "../../../../../features/channels/channels.js"

export const Route = createFileRoute("/_authed/_shell/settings/channels/$provider")({
  head: () => ({ meta: [{ title: "Channels · Ren" }] }),
  params: {
    parse: (params) => {
      if (!Schema.is(Channel.Provider)(params.provider)) throw notFound()
      return { provider: params.provider }
    },
  },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      installed: Schema.optionalKey(Schema.String),
      error: Schema.optionalKey(Schema.String),
      connect: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  loaderDeps: (options) => ({ connect: options.search.connect === true }),
  loader: async (options) => {
    const context = options.context
    const installs = await context.queryClient.query(
      context.api["channel-install"].list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
    )
    if (!options.deps.connect || installs.items.some((install) => install.provider === options.params.provider))
      return installs
    const started = await context.client["channel-connect"]["channel-install"]
      .start({ provider: options.params.provider })
      .catch((cause: unknown) => {
        throw redirect({
          to: "/settings/channels/$provider",
          params: options.params,
          search: { error: Channels.describe(cause) },
          replace: true,
        })
      })
    if (context.platform.redirect) context.platform.redirect(started.redirectUrl)
    else context.platform.openExternal(started.redirectUrl)
    return installs
  },
  component: ChannelProviderRoute,
})

function ChannelProviderRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const context = Route.useRouteContext()
  return (
    <ChannelProviderPage
      provider={params.provider}
      userId={context.me.user.id}
      installed={search.installed}
      error={search.error}
    />
  )
}
