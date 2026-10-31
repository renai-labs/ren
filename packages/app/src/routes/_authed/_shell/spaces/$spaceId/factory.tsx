import { createFileRoute } from "@tanstack/react-router"
import { SpaceFactoryTab } from "../../../../../features/spaces/space-factory.js"
import { Routing } from "../../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/factory")({
  head: () => ({ meta: [{ title: "Factory · Space · Ren" }] }),
  validateSearch: Routing.PageSearch,
  component: SpaceFactoryTab,
})
