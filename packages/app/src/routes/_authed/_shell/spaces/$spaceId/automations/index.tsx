import { createFileRoute } from "@tanstack/react-router"
import { RunSheet } from "../../../automations/-run-sheet.js"
import { SpaceAutomationsTab } from "../../../../../../features/automations/automations-page.js"
import { Automations } from "../../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/")({
  head: () => ({ meta: [{ title: "Automations · Space · Ren" }] }),
  validateSearch: Automations.Search,
  wrapInSuspense: false,
  component: RouteComponent,
})

function RouteComponent() {
  const session = Route.useSearch().session
  const navigate = Route.useNavigate()
  return (
    <>
      <SpaceAutomationsTab />
      <RunSheet
        session={session}
        onClose={() => void navigate({ search: (previous) => ({ ...previous, session: undefined }), replace: true })}
      />
    </>
  )
}
