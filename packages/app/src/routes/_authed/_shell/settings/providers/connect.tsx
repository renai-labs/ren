import { createFileRoute } from "@tanstack/react-router"
import { ConnectProviderPage } from "../../../../../features/providers/connect-provider-page.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers/connect")({
  head: () => ({ meta: [{ title: "Connect provider · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(options.context.api.provider.list.queryOptions()))
  },
  component: ConnectProviderPage,
})
