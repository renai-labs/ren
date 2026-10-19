import { SpaceEnvironment } from "@ren/core/space/environment"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const SpaceEnvironmentHandler = HttpApiBuilder.group(Api, "space-environment", (handlers) =>
  Effect.gen(function* () {
    const spaceEnvironments = yield* SpaceEnvironment.Service
    return handlers
      .handle("space-environment.list", Primitive.list(spaceEnvironments.list))
      .handle("space-environment.create", Primitive.create(spaceEnvironments.create))
      .handle("space-environment.archive", Primitive.archive(spaceEnvironments.archive))
  }),
)
