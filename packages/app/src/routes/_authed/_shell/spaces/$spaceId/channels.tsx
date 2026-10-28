import { Pagination } from "@ren/schema/pagination"
import { Page } from "@ren/ui/page"
import { createFileRoute } from "@tanstack/react-router"
import { SpaceChannels } from "../../../../../features/channels/space-channels.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/channels")({
  head: () => ({ meta: [{ title: "Space channels · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["channel-install"].list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
      ),
    )
  },
  pendingComponent: () => <Page.Skeletons body="rows" />,
  component: SpaceChannelsRoute,
})

function SpaceChannelsRoute() {
  const params = Route.useParams()
  const context = Route.useRouteContext()
  return <SpaceChannels key={params.spaceId} spaceId={params.spaceId} userId={context.me.user.id} />
}
