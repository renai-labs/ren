import { ForbiddenError } from "@ren/protocol/errors"
import { ActiveOrganization, CurrentOrganization } from "@ren/protocol/middleware/active-organization"
import { CurrentSession } from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { Auth } from "../auth.js"

export const ActiveOrganizationLayer = Layer.effect(
  ActiveOrganization,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return ActiveOrganization.of(
      Effect.fn("ActiveOrganization")(function* (httpEffect) {
        const session = yield* CurrentSession
        const request = yield* HttpServerRequest.HttpServerRequest
        const organization = yield* auth.getActiveOrganization(session, new Headers(request.headers))
        if (Option.isNone(organization)) {
          return yield* new ForbiddenError({ message: "Join or create an organization to continue." })
        }
        return yield* Effect.provideService(httpEffect, CurrentOrganization, { id: organization.value.id })
      }),
    )
  }),
)
