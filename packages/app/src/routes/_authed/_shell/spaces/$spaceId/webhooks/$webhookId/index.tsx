import { createFileRoute } from "@tanstack/react-router"
import { WebhookPage } from "../../../../../../../features/webhooks/webhook-page.js"
import { Loader } from "../../../../../../../lib/loader.js"
import { Webhooks } from "../../../../../../../lib/webhooks.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/webhooks/$webhookId/")({
  head: () => ({ meta: [{ title: "Webhook · Space · Ren" }] }),
  validateSearch: Webhooks.Search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.webhook.get.queryOptions({ idOrSlug: options.params.webhookId }),
      ),
      options.context.queryClient.query(
        options.context.api["webhook-delivery"].list.queryOptions({
          webhookId: options.params.webhookId,
          page: 1,
          pageSize: 50,
        }),
      ),
    )
  },
  wrapInSuspense: false,
  component: WebhookPage,
})
