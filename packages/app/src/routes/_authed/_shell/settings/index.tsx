import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/settings/")({
  head: () => ({ meta: [{ title: "Settings · Ren" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/settings/preferences", replace: true })
  },
})
