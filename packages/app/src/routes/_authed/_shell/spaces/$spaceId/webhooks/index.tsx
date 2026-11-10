import { createFileRoute } from "@tanstack/react-router"
import { WebhooksTab } from "../../../../../../features/webhooks/webhooks-tab.js"
import { Loader } from "../../../../../../lib/loader.js"
import { Webhooks } from "../../../../../../lib/webhooks.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/webhooks/")({
  head: () => ({ meta: [{ title: "Webhooks · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.webhook.list.queryOptions(Webhooks.listInput(options.params.spaceId)),
      ),
    )
  },
  wrapInSuspense: false,
  component: SpaceWebhooks,
})

function SpaceWebhooks() {
  return <WebhooksTab spaceId={Route.useParams().spaceId} />
}
