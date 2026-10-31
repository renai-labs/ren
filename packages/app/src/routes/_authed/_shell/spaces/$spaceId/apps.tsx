import { createFileRoute } from "@tanstack/react-router"
import { SpaceAppsTab } from "../../../../../features/spaces/space-apps.js"
import { Routing } from "../../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/apps")({
  head: () => ({ meta: [{ title: "Apps · Space · Ren" }] }),
  validateSearch: Routing.AppSearch,
  component: SpaceAppsTab,
})
