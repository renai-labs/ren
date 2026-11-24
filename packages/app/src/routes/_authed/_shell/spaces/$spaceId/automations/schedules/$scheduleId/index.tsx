import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/schedules/$scheduleId/")({
  head: () => ({ meta: [{ title: "Automations · Ren" }] }),
  beforeLoad: async (options) => {
    const schedule = await options.context.queryClient
      .query(options.context.api.schedule.get.queryOptions({ idOrSlug: options.params.scheduleId }))
      .catch(() => undefined)
    throw redirect(
      schedule
        ? { to: "/spaces/$spaceId/automations/$slug", params: { spaceId: schedule.spaceId, slug: schedule.slug } }
        : { to: "/spaces/$spaceId/automations", params: { spaceId: options.params.spaceId } },
    )
  },
})
