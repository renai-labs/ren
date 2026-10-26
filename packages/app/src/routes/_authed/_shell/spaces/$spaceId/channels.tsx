import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { SpaceChannels } from "../../../../../features/channels/space-channels.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/channels")({
  head: () => ({ meta: [{ title: "Space channels · Ren" }] }),
  loader: (options) =>
    options.context.queryClient.query(
      options.context.api["channel-install"].list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
    ),
  component: SpaceChannelsRoute,
})

function SpaceChannelsRoute() {
  const params = Route.useParams()
  const context = Route.useRouteContext()
  return <SpaceChannels key={params.spaceId} spaceId={params.spaceId} userId={context.me.user.id} />
}
