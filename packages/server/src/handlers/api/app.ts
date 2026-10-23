import { App } from "@ren/core/app"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const AppHandler = HttpApiBuilder.group(Api, "app", (handlers) =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    return handlers
      .handle("app.list", Primitive.list(apps.list))
      .handle("app.get", Primitive.get(apps.get))
      .handle("app.create", Primitive.create(apps.create))
      .handle("app.update", Primitive.update(apps.update))
      .handle("app.archive", Primitive.archive(apps.archive))
      .handle("app.transferOwnership", Primitive.action(apps.transferOwnership))
  }),
)
