import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  beforeLoad: (options) => {
    throw redirect({ to: "/sessions", search: options.search, replace: true })
  },
})
