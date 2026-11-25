import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding · Ren" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/settings/onboarding", replace: true })
  },
})
