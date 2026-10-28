import { Pagination } from "@ren/schema/pagination"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { OrgApps } from "../../../../features/apps/org-apps.js"
import { CredentialsPage } from "../../../../features/credentials/credentials-page.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/credentials")({
  head: () => ({ meta: [{ title: "Credentials · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ tab: Schema.optionalKey(Schema.Literal("credentials")), app: Schema.optionalKey(Schema.String) }),
  ),
  loader: (options) => {
    const context = options.context
    const page = { page: 1, pageSize: Pagination.maximumPageSize }
    Loader.start(
      context.queryClient.query(context.api.credential.list.queryOptions(page)),
      context.queryClient.query(context.api.space.list.queryOptions(page)),
    )
  },
  component: CredentialsRoute,
})

function CredentialsRoute() {
  const context = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <CredentialsPage
      userId={context.me.user.id}
      tab={search.tab ?? "apps"}
      onTabChange={(tab) => void navigate({ search: tab === "credentials" ? { tab } : {}, replace: true })}
      apps={
        <OrgApps
          appId={search.app}
          onAppChange={(app) => void navigate({ search: app ? { app } : {}, replace: true })}
        />
      }
    />
  )
}
