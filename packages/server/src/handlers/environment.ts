import { Environments } from "@ren/core/environments"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const EnvironmentHandler = HttpApiBuilder.group(Api, "environment", (handlers) =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    return handlers
      .handle("environment.list", Primitive.list(environments.list))
      .handle("environment.get", Primitive.get(environments.get))
      .handle("environment.create", Primitive.create(environments.create))
      .handle("environment.update", Primitive.update(environments.update))
      .handle("environment.archive", Primitive.archive(environments.archive))
  }),
)

export const HandProviderHandler = HttpApiBuilder.group(Api, "handProvider", (handlers) =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    return handlers.handle("handProvider.list", () => environments.providers)
  }),
)
