import { createFileRoute } from "@tanstack/react-router"
import { ProvidersPage } from "../../../../features/providers/providers-page.js"
import { usePlatform } from "../../../../platform/platform.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers")({
  head: () => ({ meta: [{ title: "Providers · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(options.context.api["ren-inference"].connection.list.queryOptions()))
  },
  component: ProvidersRoute,
})

function ProvidersRoute() {
  const platform = usePlatform()
  return <ProvidersPage returnUrl={`${platform.appUrl}/settings/providers`} />
}
