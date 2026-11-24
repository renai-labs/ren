import { createFileRoute } from "@tanstack/react-router"
import { RunSheet } from "../../../automations/-run-sheet.js"
import { SpaceAutomationEditorPage } from "../../../../../../features/automations/automations-page.js"
import { Automations } from "../../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/$slug")({
  head: () => ({ meta: [{ title: "Automation · Space · Ren" }] }),
  validateSearch: Automations.EditorSearch,
  wrapInSuspense: false,
  component: RouteComponent,
})

function RouteComponent() {
  const session = Route.useSearch().session
  const navigate = Route.useNavigate()
  return (
    <>
      <SpaceAutomationEditorPage />
      <RunSheet
        session={session}
        onClose={() => void navigate({ search: (previous) => ({ ...previous, session: undefined }), replace: true })}
      />
    </>
  )
}
