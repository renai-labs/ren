import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { canAdministerOptions } from "../../../../lib/auth.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin")({
  beforeLoad: async (options) => {
    const canAdminister = await options.context.queryClient.query(canAdministerOptions(options.context.auth))
    if (!canAdminister) throw redirect({ to: "/settings/preferences", replace: true })
  },
  component: Outlet,
})
