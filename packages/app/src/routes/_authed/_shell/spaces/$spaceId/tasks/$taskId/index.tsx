import { Tasks } from "@ren/client/react"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { Loader } from "../../../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/tasks/$taskId/")({
  head: () => ({ meta: [{ title: "Task · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ session: Schema.optional(Schema.String) })),
  loader: (options) => {
    const context = options.context
    Loader.start(
      context.queryClient.query(context.api.task.get.queryOptions({ idOrSlug: options.params.taskId })),
      context.queryClient.query(Tasks.activity(context.client, options.params.taskId)),
      ...(options.params.taskId.startsWith("tsk_")
        ? [context.queryClient.query(context.api.task.list.queryOptions(Tasks.subtasksInput(options.params.taskId)))]
        : []),
    )
  },
})
