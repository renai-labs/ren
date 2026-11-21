import { createFileRoute } from "@tanstack/react-router"
import { AutomationsView } from "../../../../../../features/automations/automations-page.js"
import { WebhooksTab } from "../../../../../../features/webhooks/webhooks-tab.js"
import { Automations } from "../../../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/")({
  head: () => ({ meta: [{ title: "Automations · Space · Ren" }] }),
  validateSearch: Automations.Search,
  loaderDeps: Automations.loaderDeps,
  loader: (options) => Automations.preload(options.context, options.deps, options.params.spaceId),
  wrapInSuspense: false,
  component: SpaceAutomations,
})

function SpaceAutomations() {
  const navigate = Route.useNavigate()
  const spaceId = Route.useParams().spaceId
  return (
    <AutomationsView
      search={Route.useSearch()}
      spaceId={spaceId}
      setSearch={(update, navigation) =>
        void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false })
      }
      webhooks={<WebhooksTab spaceId={spaceId} />}
    />
  )
}
