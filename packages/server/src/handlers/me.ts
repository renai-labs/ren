import { CurrentSession, CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Auth } from "../auth.js"

export const MeHandler = HttpApiBuilder.group(Api, "me", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return handlers.handle("me.get", () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const session = yield* CurrentSession
        const request = yield* HttpServerRequest.HttpServerRequest
        const organization = yield* auth.getActiveOrganization(session, new Headers(request.headers))
        return { user, organization: Option.getOrNull(organization) }
      }),
    )
  }),
)
