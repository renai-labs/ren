import { createFileRoute } from "@tanstack/react-router"
import { SpaceOverviewTab } from "../../../../../features/spaces/space-overview.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/")({
  head: () => ({ meta: [{ title: "Overview · Space · Ren" }] }),
  component: SpaceOverviewTab,
})
