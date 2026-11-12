import { createFileRoute } from "@tanstack/react-router"
import { SchedulesPage } from "../../../features/schedules/schedules-page.js"
import { Loader } from "../../../lib/loader.js"
import { Pages } from "../../../lib/pages.js"
import { scheduleListInput, ScheduleSearch } from "../../../lib/schedules.js"

export const Route = createFileRoute("/_authed/_shell/schedules")({
  head: () => ({ meta: [{ title: "Scheduled · Ren" }] }),
  validateSearch: ScheduleSearch,
  loaderDeps: (options) => ({ filters: options.search.filters }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(
        Pages.schedules(options.context.client, scheduleListInput(options.deps, {})),
      ),
    )
  },
  component: SchedulesPage,
})
