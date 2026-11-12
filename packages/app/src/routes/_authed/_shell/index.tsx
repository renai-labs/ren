import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { Composer } from "@ren/chat"
import { HomePage } from "../../../features/session/home-page.js"
import { pickerPageSize } from "../../../lib/pagination.js"
import { ChatQueries } from "../../../lib/chat-queries.js"
import { Loader } from "../../../lib/loader.js"
import { Drafts } from "../../../lib/drafts.js"

export const Route = createFileRoute("/_authed/_shell/")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      spaceId: Schema.optional(Schema.String),
      prompt: Schema.optional(Schema.String),
      artifact: Schema.optional(Schema.String),
      artifactName: Schema.optional(Schema.String),
    }),
  ),
  head: () => ({ meta: [{ title: "New chat · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
      ),
      ...ChatQueries.start(options.context, options.context.me.organization?.id),
    )
  },
  component: HomeRoute,
})

function HomeRoute() {
  const search = Route.useSearch()
  let draftKey = search.spaceId ? `new.space.${search.spaceId}` : Drafts.fresh
  if (search.prompt) draftKey = `new.space.${search.spaceId ?? ""}.artifact.${search.artifact ?? "create"}`
  return (
    <HomePage
      key={`${search.spaceId ?? ""}:${search.artifact ?? ""}:${search.prompt ?? ""}`}
      draftKey={draftKey}
      initialDraft={Composer.withText(Composer.empty, search.prompt ?? "")}
      artifact={
        search.artifact && search.artifactName ? { id: search.artifact, title: search.artifactName } : undefined
      }
    />
  )
}
