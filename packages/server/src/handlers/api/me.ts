import { AccountDeletion } from "@ren/core/account-deletion"
import { ConflictError } from "@ren/protocol/errors"
import { CurrentSession, CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Auth } from "../../auth.js"

export const MeHandler = HttpApiBuilder.group(Api, "me", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const accountDeletion = yield* AccountDeletion.Service
    return handlers
      .handle("me.get", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const session = yield* CurrentSession
          const request = yield* HttpServerRequest.HttpServerRequest
          const membership = yield* auth.getActiveMembership(session, new Headers(request.headers))
          return { user, organization: Option.getOrNull(Option.map(membership, (active) => active.organization)) }
        }),
      )
      .handle("me.requestDeletion", () =>
        Effect.flatMap(CurrentUser, (user) =>
          accountDeletion
            .request(user)
            .pipe(
              Effect.catchTag("AccountDeletion.SoleOwner", (error) =>
                Effect.fail(new ConflictError({ message: error.message })),
              ),
            ),
        ),
      )
  }),
)
