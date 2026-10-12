import { createFileRoute, redirect } from "@tanstack/react-router"

const legacy: Record<string, string> = {
  "/settings": "/sessions/settings/preferences",
  "/org/members": "/sessions/settings/members",
  "/org/settings": "/sessions/settings/general",
}

export const Route = createFileRoute("/_authed/_shell/$")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  beforeLoad: (options) => {
    throw redirect({ href: legacy[options.location.pathname.replace(/\/+$/, "")] ?? "/sessions", replace: true })
  },
})
