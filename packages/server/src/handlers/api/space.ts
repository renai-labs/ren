import { Space } from "@ren/core/space"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const SpaceHandler = HttpApiBuilder.group(Api, "space", (handlers) =>
  Effect.gen(function* () {
    const spaces = yield* Space.Service
    return handlers
      .handle("space.list", Primitive.list(spaces.list))
      .handle("space.get", Primitive.get(spaces.get))
      .handle("space.create", Primitive.create(spaces.create))
      .handle("space.update", Primitive.update(spaces.update))
      .handle("space.archive", Primitive.archive(spaces.archive))
  }),
)
