import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { AppBoot } from "../components/app-boot.js"
import { authKeys, sessionOptions } from "../lib/auth.js"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async (options) => {
    const queryClient = options.context.queryClient
    const location = options.location
    const session = await queryClient.query(sessionOptions(options.context.auth))
    if (!session) throw redirect({ to: "/login", search: { redirect: location.href } })
    const me = await queryClient.query(options.context.api.me.get.queryOptions())
    if (me.organization || location.pathname === "/organizations/new") return { me }
    const invitations = await queryClient.query({
      queryKey: authKeys.invitations(),
      queryFn: () => options.context.auth.organization.listUserInvitations(),
    })
    const pending = invitations.data?.find((invitation) => invitation.status === "pending")
    if (pending) throw redirect({ to: "/invites/accept", search: { id: pending.id, redirect: location.href } })
    throw redirect({ to: "/organizations/new" })
  },
  pendingComponent: AppBoot,
  component: Outlet,
})
