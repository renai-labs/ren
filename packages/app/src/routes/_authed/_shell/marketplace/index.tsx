import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppsPage } from "../../../../features/apps/apps-page.js"
import { Apps } from "../../../../components/apps.js"
import { Loader } from "../../../../lib/loader.js"
import { Pages } from "../../../../lib/pages.js"

export const Route = createFileRoute("/_authed/_shell/marketplace/")({
  head: () => ({ meta: [{ title: "Marketplace · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ view: Schema.optionalKey(Schema.Literal("in-use")), app: Schema.optionalKey(Schema.String) }),
  ),
  loader: (options) => {
    const context = options.context
    Loader.start(
      context.queryClient.query(
        Pages.all((index) => context.api["app-registry"].list.queryOptions({ ...Apps.page, page: index })),
      ),
      context.queryClient.query(Pages.all((index) => context.api.app.list.queryOptions({ ...Apps.page, page: index }))),
    )
  },
  component: AppsRoute,
})

function AppsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const go = (next: { readonly view: "browse" | "in-use"; readonly app: string | undefined }) =>
    void navigate({
      search: { ...(next.view === "in-use" && { view: next.view }), ...(next.app && { app: next.app }) },
      replace: true,
    })
  const view = search.view ?? "browse"
  return (
    <AppsPage
      view={view}
      appId={search.app}
      onViewChange={(next) => go({ view: next, app: search.app })}
      onAppChange={(app) => go({ view, app })}
    />
  )
}
