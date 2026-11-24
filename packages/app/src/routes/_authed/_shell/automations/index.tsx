import { createFileRoute, redirect } from "@tanstack/react-router"
import { AutomationsPage } from "../../../../features/automations/automations-page.js"
import { Automations } from "../../../../lib/automations.js"

export const Route = createFileRoute("/_authed/_shell/automations/")({
  head: () => ({ meta: [{ title: "Automations · Ren" }] }),
  validateSearch: Automations.Search,
  beforeLoad: async (options) => {
    const id = options.search.schedule
    if (!id) return
    const schedule = await options.context.queryClient
      .query(options.context.api.schedule.get.queryOptions({ idOrSlug: id }))
      .catch(() => undefined)
    if (schedule)
      throw redirect({ to: "/automations/$spaceId/$slug", params: { spaceId: schedule.spaceId, slug: schedule.slug } })
  },
  component: AutomationsPage,
})
