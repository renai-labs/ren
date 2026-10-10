export * as Routes from "./routes.js"

import { Health } from "@ren/core/health"
import { Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./api.js"
import { HealthHandler } from "./handlers/health.js"

export const layer = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(HealthHandler),
  Layer.provide(Health.layer),
)
