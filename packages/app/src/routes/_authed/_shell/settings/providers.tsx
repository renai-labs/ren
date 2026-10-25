import { createFileRoute } from "@tanstack/react-router"
import { ProvidersPage } from "../../../../features/providers/providers-page.js"
import { Auth } from "../../../../lib/auth.js"
import { usePlatform } from "../../../../platform/platform.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers")({
  head: () => ({ meta: [{ title: "Providers · Ren" }] }),
  loader: async (options) => {
    const context = options.context
    const [role] = await Promise.all([
      context.queryClient.query(Auth.activeRoleOptions(context.auth)),
      context.queryClient.query(context.api["ren-inference"].connection.list.queryOptions()).catch(() => undefined),
    ])
    return { canEdit: Auth.isAdminRole(role) }
  },
  component: ProvidersRoute,
})

function ProvidersRoute() {
  const data = Route.useLoaderData()
  const platform = usePlatform()
  if (!data.canEdit) return <ProvidersPage />
  return <ProvidersPage manage={{ returnUrl: `${platform.appUrl}/settings/providers` }} />
}
