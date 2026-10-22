import { Label } from "@ren/core/label"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const LabelHandler = HttpApiBuilder.group(Api, "label", (handlers) =>
  Effect.gen(function* () {
    const labels = yield* Label.Service
    return handlers
      .handle("label.list", Primitive.list(labels.list))
      .handle("label.create", Primitive.create(labels.create))
      .handle("label.update", Primitive.update(labels.update))
      .handle("label.archive", Primitive.archive(labels.archive))
  }),
)
