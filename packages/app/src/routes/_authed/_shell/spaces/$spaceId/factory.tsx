import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceFactory } from "../../../../../features/spaces/space-factory.js"
import { spaceAgentsOptions } from "../../../../../features/spaces/use-space.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/factory")({
  head: () => ({ meta: [{ title: "Factory · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ view: Schema.optional(Schema.Literals(["flow", "spec"])) }),
  ),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(spaceAgentsOptions(options.context.api, options.params.spaceId)))
  },
  wrapInSuspense: false,
  component: SpaceFactoryRoute,
})

function SpaceFactoryRoute() {
  const navigate = Route.useNavigate()
  return (
    <SpaceFactory
      view={Route.useSearch({ select: (search) => search.view ?? "flow" })}
      onView={(view) => void navigate({ search: view === "spec" ? { view } : {}, replace: true })}
    />
  )
}
