import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceOverviewTab } from "../../../../../features/spaces/space-overview.js"
import { Insights } from "../../../../../lib/insights.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/overview")({
  head: () => ({ meta: [{ title: "Overview · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ period: Schema.optional(Insights.Period) })),
  wrapInSuspense: false,
  component: SpaceOverviewRoute,
})

function SpaceOverviewRoute() {
  const navigate = Route.useNavigate()
  return (
    <SpaceOverviewTab
      period={Route.useSearch({ select: (search) => search.period ?? "7d" })}
      onPeriod={(period) => void navigate({ search: period === "7d" ? {} : { period }, replace: true })}
    />
  )
}
