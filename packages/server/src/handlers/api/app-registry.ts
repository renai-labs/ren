import { AppRegistry } from "@ren/core/app/registry"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const AppRegistryHandler = HttpApiBuilder.group(Api, "app-registry", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    return handlers
      .handle("app-registry.list", Primitive.list(registry.list))
      .handle("app-registry.get", Primitive.get(registry.get))
  }),
)
