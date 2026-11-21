import { createFileRoute } from "@tanstack/react-router"
import { NewAutomationPage } from "../../../../features/automations/automations-page.js"
import { Automations } from "../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/automations/new")({
  head: () => ({ meta: [{ title: "New automation · Ren" }] }),
  validateSearch: Automations.EditorSearch,
  component: NewAutomationPage,
})
