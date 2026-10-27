import { getRouteApi } from "@tanstack/react-router"
import { useSchedules } from "@/hooks/use-schedules"

const route = getRouteApi("/_authed/_shell/schedules")

export function useSchedulesPage() {
  const navigate = route.useNavigate()
  return useSchedules({
    search: route.useSearch(),
    setSearch: (update, navigation) =>
      void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false }),
  })
}
