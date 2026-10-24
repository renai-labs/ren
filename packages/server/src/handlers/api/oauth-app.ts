import { OAuthApps } from "@ren/core/oauth-apps"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const OAuthAppHandler = HttpApiBuilder.group(Api, "oauth-app", (handlers) =>
  Effect.gen(function* () {
    const apps = yield* OAuthApps.Service
    return handlers
      .handle("oauth-app.list", Primitive.list(apps.list))
      .handle("oauth-app.get", Primitive.get(apps.get))
      .handle("oauth-app.create", Primitive.create(apps.create))
      .handle("oauth-app.update", Primitive.update(apps.update))
      .handle(
        "oauth-app.archive",
        Primitive.archive((actor, id) => apps.archive(actor, id)),
      )
  }),
)
