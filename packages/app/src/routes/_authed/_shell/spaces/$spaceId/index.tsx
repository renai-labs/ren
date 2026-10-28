import { Page } from "@ren/ui/page"
import { createFileRoute } from "@tanstack/react-router"
import { SpaceOverview } from "../../../../../features/spaces/space-overview.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/")({
  head: () => ({ meta: [{ title: "Space · Ren" }] }),
  pendingComponent: () => <Page.Skeletons body="rows" />,
  component: SpaceOverviewRoute,
})

function SpaceOverviewRoute() {
  const params = Route.useParams()
  return <SpaceOverview spaceId={params.spaceId} />
}
