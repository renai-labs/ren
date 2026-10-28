import { Page } from "@ren/ui/page"
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { Schema } from "effect"
import { RouteError } from "../../../../components/error-page.js"
import { TaskSearch } from "../../../../features/tasks/task-search.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(TaskSearch.SearchParams),
  loaderDeps: (options) => ({ filters: options.search.filters }),
  loader: (options) => {
    const context = options.context
    const organization = context.me.organization
    const filters =
      options.deps.filters ??
      TaskSearch.savedFilters(context.me.user.id, organization?.id ?? "").read(context.platform.storage)
    Loader.start(
      import("../../../../features/tasks/task-queries.js").then((queries) => {
        const catalog = queries.TaskQueries.catalogOptions(context.api)
        Loader.start(
          context.queryClient.query(queries.TaskQueries.listOptions(context.api, filters)),
          context.queryClient.query(catalog[0]),
          context.queryClient.query(catalog[1]),
          context.queryClient.query(catalog[2]),
        )
      }),
    )
  },
  pendingComponent: () => <Page.Pending title="Tasks" width="full" />,
  errorComponent: (props) => <RouteError error={props.error} />,
  component: lazyRouteComponent(() => import("../../../../features/tasks/tasks-page.js"), "TasksPage"),
})
