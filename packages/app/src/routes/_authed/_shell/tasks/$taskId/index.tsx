import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { Session } from "@ren/schema/session"
import { RouteError } from "../../../../../components/error-page.js"
import { Tasks } from "../../../../../features/tasks/tasks.js"

export const Route = createFileRoute("/_authed/_shell/tasks/$taskId/")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ session: Schema.optionalKey(Session.ID), child: Schema.optionalKey(Session.ID) }),
  ),
  loader: (options) => {
    const catalog = Tasks.catalogOptions(options.context.api)
    return Promise.all([
      options.context.queryClient.query(options.context.api.task.get.queryOptions({ idOrSlug: options.params.taskId })),
      options.context.queryClient.query(catalog[0]),
      options.context.queryClient.query(catalog[1]),
      options.context.queryClient.query(catalog[2]),
    ])
  },
  head: (options) => ({ meta: [{ title: `${options.loaderData?.[0].title ?? "Task"} · Ren` }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
})
