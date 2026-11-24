import { View } from "@ren/core/view"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ViewHandler = HttpApiBuilder.group(Api, "view", (handlers) =>
  Effect.gen(function* () {
    const views = yield* View.Service
    return handlers
      .handle("view.list", Primitive.list(views.list))
      .handle("view.create", Primitive.create(views.create))
      .handle("view.update", Primitive.update(views.update))
      .handle("view.archive", Primitive.archive(views.archive))
  }),
)
