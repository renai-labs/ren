import { RegistryProvider } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { AppBoot } from "../components/app-boot.js"
import { Auth } from "../lib/auth.js"

export const Route = createFileRoute("/_authed")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  beforeLoad: async (options) => {
    const context = options.context
    const session = await context.queryClient.query(Auth.sessionOptions(context.auth))
    if (session === null) throw redirect({ to: "/login", search: { redirect: options.location.href } })
    const me = await context.queryClient.query(context.api.me.get.queryOptions())
    if (me.organization !== null) return { session, me }
    const invitations = await context.auth.organization.listUserInvitations()
    const pending = invitations.data?.find((invitation) => invitation.status === "pending")
    if (pending !== undefined) {
      throw redirect({ to: "/invites/accept", search: { id: pending.id, redirect: options.location.href } })
    }
    throw new Error("Could not load your organization")
  },
  pendingComponent: AppBoot,
  component: Authed,
})

function Authed() {
  const context = Route.useRouteContext()
  return (
    <RegistryProvider key={context.me.user.id}>
      <ChatReact.Provider atoms={context.chat(context.me.user.id)}>
        <Outlet />
      </ChatReact.Provider>
    </RegistryProvider>
  )
}
