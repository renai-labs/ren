import { Insights } from "@ren/schema/insights"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const InsightsGroup = HttpApiGroup.make("insights")
  .add(
    HttpApiEndpoint.get("insights.query", "/insights", {
      query: Insights.Query,
      success: Insights.Result,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "insights.query",
        summary: "Query insights",
        description:
          "Return what a space, or the whole organization, spent and finished in a range, as one row for the whole range or one row for each bucket, space, member, agent, model or provider. 403: the organization’s usage, for a member who is not an admin or owner.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "internal")
  .annotateMerge(OpenApi.annotations({ title: "insights" }))
