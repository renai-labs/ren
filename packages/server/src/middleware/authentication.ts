import { UnauthorizedError } from "@ren/protocol/errors"
import {
  Authentication,
  type AuthenticatedSession,
  CurrentSession,
  CurrentUser,
} from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"
import { Auth } from "../auth.js"

const unauthorized = new UnauthorizedError({ message: "Sign in to continue." })

export const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const authenticate = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const session = yield* auth.getSession(new Headers(request.headers))
      if (Option.isNone(session)) return yield* unauthorized
      return session.value
    })
    const provideSession = <A, E, R>(httpEffect: Effect.Effect<A, E, R>, session: AuthenticatedSession) =>
      httpEffect.pipe(Effect.provideService(CurrentUser, session.user), Effect.provideService(CurrentSession, session))
    return Authentication.of({
      bearer: Effect.fn("Authentication.bearer")(function* (httpEffect, options) {
        if (Redacted.value(options.credential) === "") return yield* unauthorized
        const session = yield* authenticate
        return yield* provideSession(httpEffect, session)
      }),
      cookie: Effect.fn("Authentication.cookie")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!request.headers.cookie) return yield* unauthorized
        const session = yield* authenticate
        return yield* provideSession(httpEffect, session)
      }),
    })
  }),
)
