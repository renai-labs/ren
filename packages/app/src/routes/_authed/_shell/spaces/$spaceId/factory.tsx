import { createFileRoute } from "@tanstack/react-router"
import { SpaceFactoryTab } from "../../../../../features/spaces/space-factory.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/factory")({
  head: () => ({ meta: [{ title: "Factory · Space · Ren" }] }),
  wrapInSuspense: false,
  component: SpaceFactoryTab,
})
