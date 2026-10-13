import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { Auth } from "../../../../lib/auth.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin")({
  beforeLoad: async (options) => {
    const role = await options.context.queryClient.query(Auth.activeRoleOptions(options.context.auth))
    if (!Auth.isAdminRole(role)) throw redirect({ to: "/settings/preferences", replace: true })
  },
  component: Outlet,
})
