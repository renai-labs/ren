import { Channel } from "@ren/schema/channel"
import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { ChannelProviderPage } from "../../../../../features/channels/channel-provider-page.js"
import { errorMessage } from "../../../../../lib/errors.js"
import { pickerPageSize } from "../../../../../lib/pagination.js"
import { Channels } from "../../../../../lib/channels.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/channels/$provider")({
  head: () => ({ meta: [{ title: "Mentions · Ren" }] }),
  params: {
    parse: (params) => {
      if (!Schema.is(Channel.Provider)(params.provider)) throw notFound()
      return { provider: params.provider }
    },
  },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      installed: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String),
      connect: Schema.optional(Schema.Boolean),
    }),
  ),
  loaderDeps: (options) => ({ connect: options.search.connect === true }),
  loader: async (options) => {
    const queryClient = options.context.queryClient
    const params = options.params
    Loader.start(
      queryClient.query(options.context.api["channel-connect"]["channel-provider"].list.queryOptions()),
      queryClient.query(options.context.api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize })),
    )
    if (!options.deps.connect) {
      Loader.start(queryClient.query(Channels.installsOptions(options.context.api)))
      return
    }
    // ast-grep-ignore: require-loader-start -- connecting starts only when no install exists yet
    const installs = await queryClient.query(Channels.installsOptions(options.context.api))
    if (installs.items.some((install) => install.provider === params.provider)) return
    const started = await options.context.client["channel-connect"]["channel-install"]
      .start({ provider: params.provider })
      .catch((error: unknown) => {
        throw redirect({
          to: "/settings/channels/$provider",
          params,
          search: { error: errorMessage(error) },
          replace: true,
        })
      })
    options.context.platform.redirect?.(started.redirectUrl)
  },
  component: ChannelProviderPage,
})
