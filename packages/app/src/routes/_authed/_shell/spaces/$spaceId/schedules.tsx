import { createFileRoute } from "@tanstack/react-router"
import { SpaceSchedulesTab } from "../../../../../features/spaces/space-schedules.js"
import { pageSize, currentPage } from "../../../../../lib/pagination.js"
import { Loader } from "../../../../../lib/loader.js"
import { scheduleListInput, ScheduleSearch } from "../../../../../lib/schedules.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/schedules")({
  head: () => ({ meta: [{ title: "Scheduled · Space · Ren" }] }),
  validateSearch: ScheduleSearch,
  loaderDeps: (options) => ({ page: options.search.page, filters: options.search.filters }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.schedule.list.queryOptions(
          scheduleListInput(options.deps, {
            page: currentPage(options.deps),
            pageSize,
            spaceId: options.params.spaceId,
          }),
        ),
      ),
    )
  },
  component: SpaceSchedulesTab,
})
