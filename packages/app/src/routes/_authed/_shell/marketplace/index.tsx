import { createFileRoute, redirect } from "@tanstack/react-router"
import { Routing } from "../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/marketplace/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  validateSearch: Routing.AppSearch,
  beforeLoad: (options) => {
    const app = options.search.app
    if (app) throw redirect({ to: "/apps/$appId", params: { appId: app }, replace: true })
    throw redirect({ to: "/apps", replace: true })
  },
})
