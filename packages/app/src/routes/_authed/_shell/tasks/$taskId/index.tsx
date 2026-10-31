import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { Loader } from "../../../../../lib/loader.js"
import { taskActivityOptions } from "../../../../../lib/tasks.js"

export const Route = createFileRoute("/_authed/_shell/tasks/$taskId/")({
  head: () => ({ meta: [{ title: "Task · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ session: Schema.optional(Schema.String) })),
  loader: (options) => {
    const context = options.context
    Loader.start(
      context.queryClient.query(context.api.task.get.queryOptions({ idOrSlug: options.params.taskId })),
      context.queryClient.query(taskActivityOptions(context.client, options.params.taskId)),
    )
  },
})
