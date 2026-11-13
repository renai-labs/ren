import { createFileRoute } from "@tanstack/react-router"
import { SpaceAgentsTab } from "../../../../../features/spaces/space-agents.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/agents")({
  head: () => ({ meta: [{ title: "Agents · Space · Ren" }] }),
  wrapInSuspense: false,
  component: SpaceAgentsTab,
})
