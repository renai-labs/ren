import { createFileRoute } from "@tanstack/react-router"
import { SchedulePage } from "../../../../../../../../features/schedules/schedule-page.js"
import { Loader } from "../../../../../../../../lib/loader.js"
import { Pages } from "../../../../../../../../lib/pages.js"
import { isRunStatus, schedulePageSearch } from "../../../../../../../../lib/schedules.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/automations/schedules/$scheduleId/")({
  head: () => ({ meta: [{ title: "Schedule · Space · Ren" }] }),
  validateSearch: schedulePageSearch,
  loaderDeps: (options) => ({ status: options.search.status }),
  loader: (options) => {
    const status = options.deps.status
    Loader.start(
      options.context.queryClient.query(
        options.context.api.schedule.get.queryOptions({ idOrSlug: options.params.scheduleId }),
      ),
      options.context.queryClient.infiniteQuery(
        Pages.scheduleRuns(options.context.client, {
          scheduleId: options.params.scheduleId,
          ...(isRunStatus(status) && { status }),
        }),
      ),
    )
  },
  wrapInSuspense: false,
  component: SchedulePage,
})
