import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { CredentialsPage } from "../../../../features/credentials/credentials-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/credentials")({
  head: () => ({ meta: [{ title: "Keys · Ren" }] }),
  loader: (options) => {
    const context = options.context
    const page = { page: 1, pageSize: Pagination.maximumPageSize }
    return Promise.all([
      context.queryClient.query(context.api.credential.list.queryOptions(page)),
      context.queryClient.query(context.api.space.list.queryOptions(page)),
    ])
  },
  component: CredentialsRoute,
})

function CredentialsRoute() {
  const context = Route.useRouteContext()
  return <CredentialsPage userId={context.me.user.id} />
}
