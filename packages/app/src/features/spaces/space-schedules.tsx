import { getRouteApi } from "@tanstack/react-router"
import { PageActions } from "../../components/page.js"
import { ScheduleGrid, ScheduleToolbar } from "../../components/schedule-grid.js"
import { useSchedules } from "../../lib/use-schedules.js"
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
    <div className="flex flex-1 flex-col gap-4">
      <PageActions>
        <ScheduleToolbar list={schedules} />
      </PageActions>
      <ScheduleGrid list={schedules} />
    </div>
  )
}
