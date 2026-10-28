import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { SpaceCredentials } from "../../../../../features/credentials/space-credentials.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/credentials")({
  head: () => ({ meta: [{ title: "Space credentials · Ren" }] }),
  loader: (options) => {
    const context = options.context
    const page = { page: 1, pageSize: Pagination.maximumPageSize }
    Loader.start(
      context.queryClient.query(context.api.credential.list.queryOptions(page)),
      context.queryClient.query(context.api.space.list.queryOptions(page)),
    )
  },
  component: SpaceCredentialsRoute,
})

function SpaceCredentialsRoute() {
  const params = Route.useParams()
  const context = Route.useRouteContext()
  return <SpaceCredentials spaceId={params.spaceId} userId={context.me.user.id} />
}
