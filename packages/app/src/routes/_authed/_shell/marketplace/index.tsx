import { createFileRoute, redirect } from "@tanstack/react-router"
import { Routing } from "../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/marketplace/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  validateSearch: Routing.AppSearch,
  beforeLoad: (options) => {
    throw redirect({ to: "/apps", search: options.search, replace: true })
  },
})
