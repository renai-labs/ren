import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/schedules")({
  head: () => ({ meta: [{ title: "Automations · Space · Ren" }] }),
  beforeLoad: (options) => {
    throw redirect({ to: "/spaces/$spaceId/automations", params: { spaceId: options.params.spaceId }, replace: true })
  },
})
