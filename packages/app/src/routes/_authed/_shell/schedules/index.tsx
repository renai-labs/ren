import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { RouteError } from "../../../../components/error-page.js"

export const Route = createFileRoute("/_authed/_shell/schedules/")({
  head: () => ({ meta: [{ title: "Schedules · Ren" }] }),
  loader: async (options) => {
    const queries = await import("../../../../features/schedules/schedule-queries.js")
    return Promise.all([
      options.context.queryClient.query(queries.ScheduleQueries.listOptions(options.context.api)),
      options.context.queryClient.query(queries.ScheduleQueries.spaceOptions(options.context.api)),
    ])
  },
  errorComponent: (props) => <RouteError error={props.error} />,
  component: lazyRouteComponent(() => import("../../../../features/schedules/schedules-page.js"), "SchedulesPage"),
})
