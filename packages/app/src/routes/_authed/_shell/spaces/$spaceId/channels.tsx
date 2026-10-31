import { createFileRoute } from "@tanstack/react-router"
import { SpaceChannelsTab } from "../../../../../features/spaces/space-channels.js"
import { Channels } from "../../../../../lib/channels.js"
import { Loader } from "../../../../../lib/loader.js"
import { Routing } from "../../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/channels")({
  head: () => ({ meta: [{ title: "Mentions · Space · Ren" }] }),
  validateSearch: Routing.PageSearch,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["channel-mapping"].list.queryOptions({ ...Channels.all, spaceId: options.params.spaceId }),
      ),
      options.context.queryClient.query(Channels.installsOptions(options.context.api)),
    )
  },
  component: SpaceChannelsTab,
})
