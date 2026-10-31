import { getRouteApi } from "@tanstack/react-router"
import { ListPagination } from "../../components/list-pagination.js"
import { Page } from "../../components/page.js"
import { ScheduleGrid, ScheduleToolbar } from "../../components/schedule-grid.js"
import { pageSize } from "../../lib/pagination.js"
import { useSchedules } from "../../lib/use-schedules.js"

const route = getRouteApi("/_authed/_shell/schedules")

export function SchedulesPage() {
  const navigate = route.useNavigate()
  const schedules = useSchedules({
    search: route.useSearch(),
    setSearch: (update, navigation) =>
      void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false }),
  })
  return (
    <Page
      title="Scheduled"
      description="Work that starts on a schedule instead of a message."
      actions={<ScheduleToolbar list={schedules} />}
      footer={<ListPagination page={schedules.page} pageSize={pageSize} total={schedules.total} noun="schedule" />}
    >
      <ScheduleGrid list={schedules} />
    </Page>
  )
}
