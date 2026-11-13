import { createFileRoute } from "@tanstack/react-router"
import { Page } from "../../../components/page.js"
import { AutomationsView } from "../../../features/automations/automations-page.js"
import { WebhooksTab } from "../../../features/webhooks/webhooks-tab.js"
import { Automations } from "../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/automations")({
  head: () => ({ meta: [{ title: "Automations · Ren" }] }),
  validateSearch: Automations.Search,
  loaderDeps: Automations.loaderDeps,
  loader: (options) => Automations.preload(options.context, options.deps),
  component: AutomationsPage,
})

function AutomationsPage() {
  const navigate = Route.useNavigate()
  return (
    <Page title="Automations" width="full">
      <AutomationsView
        search={Route.useSearch()}
        setSearch={(update, navigation) =>
          void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false })
        }
        webhooks={<WebhooksTab />}
      />
    </Page>
  )
}
