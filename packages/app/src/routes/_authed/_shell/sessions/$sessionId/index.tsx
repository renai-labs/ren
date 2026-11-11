import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { ChatPage } from "../../../../../features/session/chat-page.js"
import { ChatQueries } from "../../../../../lib/chat-queries.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/sessions/$sessionId/")({
  head: () => ({ meta: [{ title: "Chat · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ child: Schema.optional(Schema.String) })),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.session.get.queryOptions({ idOrSlug: options.params.sessionId }),
      ),
      ...ChatQueries.start(options.context, options.context.me.organization?.id),
    )
  },
  component: ChatPage,
})
