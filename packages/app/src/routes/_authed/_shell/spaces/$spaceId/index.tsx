import { SessionPages } from "@ren/client/react"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceInbox } from "../../../../../features/spaces/space-inbox.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/")({
  head: () => ({ meta: [{ title: "Inbox · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ chats: Schema.optional(Schema.Literals(["mine"])) })),
  loaderDeps: (options) => ({ mine: options.search.chats === "mine" }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(
        SessionPages.options(options.context.client, {
          spaceId: [options.params.spaceId],
          ...(options.deps.mine && SessionPages.own(options.context.me.user.id)),
        }),
      ),
    )
  },
  wrapInSuspense: false,
  component: Inbox,
})

function Inbox() {
  const navigate = Route.useNavigate()
  return (
    <SpaceInbox
      key={Route.useParams().spaceId}
      mine={Route.useSearch({ select: (search) => search.chats === "mine" })}
      onMineChange={(mine) => void navigate({ search: mine ? { chats: "mine" } : {}, replace: true })}
    />
  )
}
