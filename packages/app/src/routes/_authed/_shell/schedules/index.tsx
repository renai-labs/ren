import { Page } from "@ren/ui/page"
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { RouteError } from "../../../../components/error-page.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/schedules/")({
  head: () => ({ meta: [{ title: "Schedules · Ren" }] }),
  loader: (options) => {
    Loader.start(
      import("../../../../features/schedules/schedule-queries.js").then((queries) =>
        Loader.start(
          options.context.queryClient.query(queries.ScheduleQueries.listOptions(options.context.api)),
          options.context.queryClient.query(queries.ScheduleQueries.spaceOptions(options.context.api)),
        ),
      ),
    )
  },
  pendingComponent: () => (
    <Page.Pending
      title="Schedules"
      description="Work that starts on a schedule instead of a message."
      toolbar="row"
      body="cards"
      columns={3}
    />
  ),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: lazyRouteComponent(() => import("../../../../features/schedules/schedules-page.js"), "SchedulesPage"),
})
