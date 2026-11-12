import { createFileRoute } from "@tanstack/react-router"
import { SpaceSchedulesTab } from "../../../../../features/spaces/space-schedules.js"
import { Loader } from "../../../../../lib/loader.js"
import { Pages } from "../../../../../lib/pages.js"
import { scheduleListInput, ScheduleSearch } from "../../../../../lib/schedules.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/schedules")({
  head: () => ({ meta: [{ title: "Scheduled · Space · Ren" }] }),
  validateSearch: ScheduleSearch,
  loaderDeps: (options) => ({ filters: options.search.filters }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(
        Pages.schedules(options.context.client, scheduleListInput(options.deps, { spaceId: options.params.spaceId })),
      ),
    )
  },
  wrapInSuspense: false,
  component: SpaceSchedulesTab,
})
