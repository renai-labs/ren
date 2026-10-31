import { getRouteApi } from "@tanstack/react-router"
import { ListPagination } from "../../components/list-pagination.js"
import { ScheduleGrid, ScheduleToolbar } from "../../components/schedule-grid.js"
import { useSchedules } from "../../lib/use-schedules.js"
import { pageSize } from "../../lib/pagination.js"
import { useSpace } from "./use-space.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/schedules")

export function SpaceSchedulesTab() {
  const navigate = route.useNavigate()
  const schedules = useSchedules({
    search: route.useSearch(),
    spaceId: useSpace().id,
    setSearch: (update, navigation) =>
      void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false }),
  })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-1">
        <ScheduleToolbar list={schedules} />
      </div>
      <ScheduleGrid list={schedules} />
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={schedules.page} pageSize={pageSize} total={schedules.total} noun="schedule" />
      </div>
    </div>
  )
}
