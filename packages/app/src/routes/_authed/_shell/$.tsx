import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pathname } from "@ren/util/pathname"

const legacy: Record<string, string> = {
  "/org/members": "/settings/members",
  "/org/settings": "/settings/general",
}

export const Route = createFileRoute("/_authed/_shell/$")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  beforeLoad: (options) => {
    throw redirect({ href: legacy[Pathname.trimTrailingSlashes(options.location.pathname)] ?? "/", replace: true })
  },
})
