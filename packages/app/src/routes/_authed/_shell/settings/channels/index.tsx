import { createFileRoute } from "@tanstack/react-router"
import { ChannelsSettingsPage } from "../../../../../features/channels/channels-page.js"
import { Channels } from "../../../../../lib/channels.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/channels/")({
  head: () => ({ meta: [{ title: "Mentions · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(Channels.installsOptions(options.context.api)),
      options.context.queryClient.query(options.context.api["channel-connect"]["channel-provider"].list.queryOptions()),
    )
  },
  component: ChannelsSettingsPage,
})
