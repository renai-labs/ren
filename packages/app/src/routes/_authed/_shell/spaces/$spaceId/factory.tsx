import { Page } from "@ren/ui/page"
import { createFileRoute } from "@tanstack/react-router"
import { SpaceFactory } from "../../../../../features/spaces/space-factory.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/factory")({
  head: () => ({ meta: [{ title: "Space factory · Ren" }] }),
  pendingComponent: () => <Page.Skeletons body="rows" />,
  component: FactoryRoute,
})

function FactoryRoute() {
  const params = Route.useParams()
  return <SpaceFactory spaceId={params.spaceId} />
}
