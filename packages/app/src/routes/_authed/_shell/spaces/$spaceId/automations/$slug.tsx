import { createFileRoute } from "@tanstack/react-router"
import { SpaceAutomationEditorPage } from "../../../../../../features/automations/automations-page.js"
import { Automations } from "../../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/$slug")({
  head: () => ({ meta: [{ title: "Automation · Space · Ren" }] }),
  validateSearch: Automations.EditorSearch,
  wrapInSuspense: false,
  component: SpaceAutomationEditorPage,
})
