import { createFileRoute } from "@tanstack/react-router"
import { PageSkeleton } from "../../../components/page.js"
import { SchedulesPage } from "../../../features/schedules/schedules-page.js"
import { pageSize, currentPage } from "../../../lib/pagination.js"
import { Loader } from "../../../lib/loader.js"
import { scheduleListInput, ScheduleSearch } from "../../../lib/schedules.js"

export const Route = createFileRoute("/_authed/_shell/schedules")({
  head: () => ({ meta: [{ title: "Scheduled · Ren" }] }),
  validateSearch: ScheduleSearch,
  loaderDeps: (options) => ({ page: options.search.page, filters: options.search.filters }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.schedule.list.queryOptions(
          scheduleListInput(options.deps, { page: currentPage(options.deps), pageSize }),
        ),
      ),
    )
  },
  pendingComponent: SchedulesSkeleton,
  component: SchedulesPage,
})

function SchedulesSkeleton() {
  return (
    <PageSkeleton
      title="Scheduled"
      description="Work that starts on a schedule instead of a message."
      body="cards"
      columns={3}
    />
  )
}
