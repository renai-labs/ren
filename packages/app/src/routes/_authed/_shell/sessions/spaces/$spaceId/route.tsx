import { createFileRoute, Outlet } from "@tanstack/react-router"
import { RouteError } from "../../../../../../components/error-page.js"
import { SpacePage } from "../../../../../../features/spaces/space-page.js"

export const Route = createFileRoute("/_authed/_shell/sessions/spaces/$spaceId")({
  head: () => ({ meta: [{ title: "Space · Ren" }] }),
  loader: (options) =>
    options.context.queryClient.query(options.context.api.space.get.queryOptions({ idOrSlug: options.params.spaceId })),
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
