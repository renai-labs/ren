import { createFileRoute } from "@tanstack/react-router"
import { ProviderModelsPage } from "../../../../../../features/providers/provider-models-page.js"
import { Loader } from "../../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers/$id/models")({
  head: () => ({ meta: [{ title: "Models · Ren" }] }),
  loader: (options) => {
    const queryClient = options.context.queryClient
    Loader.start(
      queryClient.query(options.context.api.provider.models.list.queryOptions({ id: options.params.id })),
      queryClient.query(options.context.api.provider.list.queryOptions()),
    )
  },
  component: ProviderModelsPage,
})
