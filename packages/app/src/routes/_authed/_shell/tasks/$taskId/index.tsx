import type { TaskInfo } from "@ren/client"
import { Page } from "@ren/ui/page"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { Session } from "@ren/schema/session"
import { RouteError } from "../../../../../components/error-page.js"
import { Loader } from "../../../../../lib/loader.js"
import { Seed } from "../../../../../lib/seed.js"

export const Route = createFileRoute("/_authed/_shell/tasks/$taskId/")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ session: Schema.optionalKey(Session.ID), child: Schema.optionalKey(Session.ID) }),
  ),
  loader: (options) => {
    const context = options.context
    const task = context.api.task.get.queryOptions({ idOrSlug: options.params.taskId })
    Loader.start(
      context.queryClient.query({
        ...task,
        ...Seed.fromList<TaskInfo>(context.queryClient, [context.api.task.list.queryKey()], options.params.taskId),
      }),
      import("../../../../../features/tasks/task-queries.js").then((queries) => {
        const catalog = queries.TaskQueries.catalogOptions(context.api)
        Loader.start(
          context.queryClient.query(catalog[0]),
          context.queryClient.query(catalog[1]),
          context.queryClient.query(catalog[2]),
        )
      }),
    )
    return context.queryClient.getQueryData<TaskInfo>(task.queryKey)
  },
  head: (options) => ({ meta: [{ title: `${options.loaderData?.title ?? "Task"} · Ren` }] }),
  pendingComponent: Page.RecordPending,
  errorComponent: (props) => <RouteError error={props.error} />,
})
