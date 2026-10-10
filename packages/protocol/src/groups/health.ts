import { Health } from "@ren/schema/health"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

export const HealthGroup = HttpApiGroup.make("server.health")
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
  .annotateMerge(OpenApi.annotations({ title: "health" }))
