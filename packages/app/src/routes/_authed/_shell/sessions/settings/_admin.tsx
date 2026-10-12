import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { Auth } from "../../../../../lib/auth.js"

export const Route = createFileRoute("/_authed/_shell/sessions/settings/_admin")({
  beforeLoad: async (options) => {
    const role = await options.context.queryClient.query(Auth.activeRoleOptions(options.context.auth))
    if (!Auth.isAdminRole(role)) throw redirect({ to: "/sessions/settings/preferences", replace: true })
  },
  component: Outlet,
})
