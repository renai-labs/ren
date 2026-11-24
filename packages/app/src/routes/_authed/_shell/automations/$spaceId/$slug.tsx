import { createFileRoute } from "@tanstack/react-router"
import { RunSheet } from "../-run-sheet.js"
import { AutomationEditorPage } from "../../../../../features/automations/automations-page.js"
import { Automations } from "../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/automations/$spaceId/$slug")({
  head: () => ({ meta: [{ title: "Automation · Ren" }] }),
  validateSearch: Automations.EditorSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const session = Route.useSearch().session
  const navigate = Route.useNavigate()
  return (
    <>
      <AutomationEditorPage />
      <RunSheet
        session={session}
        onClose={() => void navigate({ search: (previous) => ({ ...previous, session: undefined }), replace: true })}
      />
    </>
  )
}
