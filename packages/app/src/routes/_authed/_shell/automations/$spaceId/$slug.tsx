import { createFileRoute } from "@tanstack/react-router"
import { AutomationEditorPage } from "../../../../../features/automations/automations-page.js"
import { Automations } from "../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/automations/$spaceId/$slug")({
  head: () => ({ meta: [{ title: "Automation · Ren" }] }),
  validateSearch: Automations.EditorSearch,
  component: AutomationEditorPage,
})
