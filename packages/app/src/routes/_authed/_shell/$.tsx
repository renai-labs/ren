import { createFileRoute, redirect } from "@tanstack/react-router"

const legacy: Record<string, string> = {
  "/org/members": "/settings/members",
  "/org/settings": "/settings/general",
}

export const Route = createFileRoute("/_authed/_shell/$")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  beforeLoad: (options) => {
    throw redirect({ href: legacy[options.location.pathname.replace(/\/+$/, "")] ?? "/", replace: true })
  },
})
