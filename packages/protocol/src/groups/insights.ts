import { Insights } from "@ren/schema/insights"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const InsightsGroup = HttpApiGroup.make("insights")
  .add(
    HttpApiEndpoint.get("insights.query", "/insights", {
      query: Insights.Query,
      success: Insights.Result,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "insights.query",
        summary: "Query insights",
        description:
          "Return what a space spent and finished in a range, as one row for the whole range or one row for each bucket, member, agent, model or provider.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "internal")
  .annotateMerge(OpenApi.annotations({ title: "insights" }))
