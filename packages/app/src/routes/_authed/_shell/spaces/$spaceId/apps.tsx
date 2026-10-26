import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceApps } from "../../../../../features/apps/space-apps.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/apps")({
  head: () => ({ meta: [{ title: "Space apps · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ app: Schema.optionalKey(Schema.String) })),
  loader: (options) =>
    options.context.queryClient
      .query(options.context.api["app-profile-reach"].space.profiles.queryOptions({ id: options.params.spaceId }))
      .catch(() => undefined),
  component: SpaceAppsRoute,
})

function SpaceAppsRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <SpaceApps
      spaceId={params.spaceId}
      appId={search.app}
      onAppChange={(app) => void navigate({ search: app ? { app } : {}, replace: true })}
    />
  )
}
