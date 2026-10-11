import { Health } from "@ren/schema/health"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"

export const HealthGroup = HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("health.get", "/api/health", {
      success: Health.Info,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "health.get",
        summary: "Get server health",
        description: "Return the server status and version.",
      }),
    ),
  )
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "health" }))
