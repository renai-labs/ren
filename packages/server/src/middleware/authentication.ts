import { Auth } from "@ren/core/auth"
import { UnauthorizedError } from "@ren/protocol/errors"
import { Authentication, CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"

const unauthorized = new UnauthorizedError({ message: "Sign in to continue." })

export const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const authenticate = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const user = yield* auth.getUser(new Headers(request.headers))
      if (Option.isNone(user)) return yield* unauthorized
      return user.value
    })
    return Authentication.of({
      bearer: Effect.fn("Authentication.bearer")(function* (httpEffect, options) {
        if (Redacted.value(options.credential) === "") return yield* unauthorized
        return yield* Effect.provideService(httpEffect, CurrentUser, yield* authenticate)
      }),
      cookie: Effect.fn("Authentication.cookie")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (request.headers.cookie === undefined) return yield* unauthorized
        return yield* Effect.provideService(httpEffect, CurrentUser, yield* authenticate)
      }),
    })
  }),
)
