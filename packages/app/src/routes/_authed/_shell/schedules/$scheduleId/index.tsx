import type { ScheduleInfo } from "@ren/client"
import { createFileRoute } from "@tanstack/react-router"
import { RouteError } from "../../../../../components/error-page.js"
import { ScheduleDetailPage } from "../../../../../features/schedules/schedule-detail-page.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/schedules/$scheduleId/")({
  loader: (options) => {
    const schedule = options.context.api.schedule.get.queryOptions({ idOrSlug: options.params.scheduleId })
    Loader.start(options.context.queryClient.query(schedule))
    return options.context.queryClient.getQueryData<ScheduleInfo>(schedule.queryKey)
  },
  head: (options) => ({ meta: [{ title: `${options.loaderData?.name ?? "Schedule"} · Ren` }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: ScheduleRoute,
})

function ScheduleRoute() {
  const params = Route.useParams()
  const navigate = Route.useNavigate()
  return <ScheduleDetailPage scheduleId={params.scheduleId} onArchived={() => void navigate({ to: "/schedules" })} />
}
