import { SpaceEnvironment } from "@ren/core/space/environment"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const SpaceEnvironmentHandler = HttpApiBuilder.group(Api, "space-environment", (handlers) =>
  Effect.gen(function* () {
    const links = yield* SpaceEnvironment.Service
    return handlers
      .handle("space-environment.list", Primitive.list(links.list))
      .handle("space-environment.create", Primitive.create(links.create))
      .handle("space-environment.archive", Primitive.archive(links.archive))
  }),
)
