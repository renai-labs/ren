import { AppRegistry } from "@ren/core/app/registry"
import { NotFoundError } from "@ren/protocol/errors"
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

export const AppToolsHandler = HttpApiBuilder.group(Api, "app-tools", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    return handlers.handle("app-tools.get", (request) =>
      Effect.flatMap(Primitive.currentActor, (actor) => registry.tools(actor, request.params.idOrSlug)).pipe(
        Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
      ),
    )
  }),
)
