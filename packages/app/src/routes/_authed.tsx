import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { Auth } from "../lib/auth.js"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(Auth.sessionOptions(options.context.auth))
    if (session === null) throw redirect({ to: "/login", search: { redirect: options.location.href } })
    return { session }
  },
  component: Outlet,
})
