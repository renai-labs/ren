import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/$")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true })
  },
})
