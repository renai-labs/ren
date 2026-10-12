import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/sessions/settings/")({
  head: () => ({ meta: [{ title: "Settings · Ren" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/sessions/settings/preferences", replace: true })
  },
})
