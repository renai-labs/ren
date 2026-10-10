import { Health } from "@ren/core/health"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"

export const HealthHandler = HttpApiBuilder.group(Api, "server.health", (handlers) =>
  Effect.gen(function* () {
    const health = yield* Health.Service
    return handlers.handle("health.get", () => health.check())
  }),
)
