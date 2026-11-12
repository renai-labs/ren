import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/marketplace/$appId/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  beforeLoad: (options) => {
    throw redirect({ to: "/apps/$appId", params: options.params, replace: true })
  },
})
