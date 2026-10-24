import { OAuth } from "@ren/core/oauth"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const OAuthSessionHandler = HttpApiBuilder.group(Api, "oauth-session", (handlers) =>
  Effect.gen(function* () {
    const oauth = yield* OAuth.Service
    return handlers.handle("oauth-session.get", Primitive.get(oauth.session))
  }),
)
