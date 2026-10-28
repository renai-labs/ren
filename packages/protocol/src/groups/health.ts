import { Health } from "@ren/schema/health"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"
import { Mcp } from "../mcp.js"

export const HealthGroup = HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("health.get", "/health", {
      success: Health.Info,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "health.get",
          summary: "Get server health",
          description: "Return the server status and version.",
        }),
      )
      .annotate(Mcp.Hidden, "Server status for load balancers; no use to an agent."),
  )
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "health" }))
