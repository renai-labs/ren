import { getRouteApi } from "@tanstack/react-router"
import { ListPagination } from "@/components/ren/list-pagination"
import { ScheduleGrid, ScheduleToolbar } from "@/components/ren/schedule-grid"
import { useSchedules } from "@/hooks/use-schedules"
import { pageSize } from "@/lib/api"
import { useSpace } from "@/routes/space/use-space"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/schedules")

export function SpaceSchedulesTab() {
  const navigate = route.useNavigate()
  const page = useSchedules({
    search: route.useSearch(),
    spaceId: useSpace().id,
    setSearch: (update, navigation) =>
      void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false }),
  })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-1">
        <ScheduleToolbar list={page} />
      </div>
      <ScheduleGrid list={page} />
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="schedule" />
      </div>
    </div>
  )
}
