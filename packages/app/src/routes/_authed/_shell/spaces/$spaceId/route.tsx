import type { SpaceInfo } from "@ren/client"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { RouteError } from "../../../../../components/error-page.js"
import { Seed } from "../../../../../lib/seed.js"
import { SpacePage } from "../../../../../features/spaces/space-page.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId")({
  head: () => ({ meta: [{ title: "Space · Ren" }] }),
  loader: (options) =>
    options.context.queryClient.query({
      ...options.context.api.space.get.queryOptions({ idOrSlug: options.params.spaceId }),
      ...Seed.fromList<SpaceInfo>(
        options.context.queryClient,
        [options.context.api.space.list.queryKey()],
        options.params.spaceId,
      ),
    }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: SpaceRoute,
})

function SpaceRoute() {
  const params = Route.useParams()
  return (
    <SpacePage key={params.spaceId} spaceId={params.spaceId}>
      <Outlet />
    </SpacePage>
  )
}
