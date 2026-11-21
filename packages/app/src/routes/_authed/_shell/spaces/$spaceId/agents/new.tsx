import { createFileRoute } from "@tanstack/react-router"
import { NewAgentPage } from "../../../../../../features/agents/agent-page.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/agents/new")({
  head: () => ({ meta: [{ title: "New agent · Space · Ren" }] }),
  wrapInSuspense: false,
  component: NewAgentPage,
})
