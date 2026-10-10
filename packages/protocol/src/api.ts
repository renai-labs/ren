import { HttpApi, OpenApi } from "effect/http-api"
import { HealthGroup } from "./groups/health.js"

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren API",
      version: "0.0.0",
      description: "Ren HTTP API.",
    }),
  )
