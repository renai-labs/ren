import { createFileRoute } from "@tanstack/react-router"
import { SpaceAutomationsTab } from "../../../../../../features/automations/automations-page.js"
import { Automations } from "../../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/")({
  head: () => ({ meta: [{ title: "Automations · Space · Ren" }] }),
  validateSearch: Automations.Search,
  wrapInSuspense: false,
  component: SpaceAutomationsTab,
})
