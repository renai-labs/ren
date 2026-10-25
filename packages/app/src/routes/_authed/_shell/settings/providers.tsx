import { createFileRoute } from "@tanstack/react-router"
import { ProvidersPage } from "../../../../features/providers/providers-page.js"
import { usePlatform } from "../../../../platform/platform.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers")({
  head: () => ({ meta: [{ title: "Providers · Ren" }] }),
  loader: async (options) => {
    await options.context.queryClient
      .query(options.context.api["ren-inference"].connection.list.queryOptions())
      .catch(() => undefined)
  },
  component: ProvidersRoute,
})

function ProvidersRoute() {
  const platform = usePlatform()
  return <ProvidersPage returnUrl={`${platform.appUrl}/settings/providers`} />
}
