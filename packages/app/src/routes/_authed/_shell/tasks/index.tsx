import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { Schema } from "effect"
import { RouteError } from "../../../../components/error-page.js"
import { TaskSearch } from "../../../../features/tasks/task-search.js"

export const Route = createFileRoute("/_authed/_shell/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(TaskSearch.SearchParams),
  loaderDeps: (options) => ({ filters: options.search.filters }),
  loader: async (options) => {
    const context = options.context
    const organization = context.me.organization
    const filters =
      options.deps.filters ??
      TaskSearch.savedFilters(context.me.user.id, organization?.id ?? "").read(context.platform.storage)
    const queries = await import("../../../../features/tasks/task-queries.js")
    const catalog = queries.TaskQueries.catalogOptions(context.api)
    return Promise.all([
      context.queryClient.query(queries.TaskQueries.listOptions(context.api, filters)),
      context.queryClient.query(catalog[0]),
      context.queryClient.query(catalog[1]),
      context.queryClient.query(catalog[2]),
    ])
  },
  errorComponent: (props) => <RouteError error={props.error} />,
  component: lazyRouteComponent(() => import("../../../../features/tasks/tasks-page.js"), "TasksPage"),
})
