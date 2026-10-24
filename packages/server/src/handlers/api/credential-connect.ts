import { OAuth } from "@ren/core/oauth"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const CredentialConnectHandler = HttpApiBuilder.group(Api, "credential-connect", (handlers) =>
  Effect.gen(function* () {
    const oauth = yield* OAuth.Service
    return handlers.handle("credential.connect", Primitive.create(oauth.connect))
  }),
)
