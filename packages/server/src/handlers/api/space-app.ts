import { SpaceApp } from "@ren/core/space/app"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const SpaceAppHandler = HttpApiBuilder.group(Api, "space-app", (handlers) =>
  Effect.gen(function* () {
    const uses = yield* SpaceApp.Service
    return handlers
      .handle("space-app.list", Primitive.list(uses.list))
      .handle("space-app.get", Primitive.get(uses.get))
      .handle("space-app.create", Primitive.create(uses.create))
      .handle("space-app.update", Primitive.update(uses.update))
      .handle("space-app.archive", Primitive.archive(uses.archive))
  }),
)
