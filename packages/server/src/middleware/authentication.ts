import type { Actor } from "@ren/core/actor"
import { UnauthorizedError } from "@ren/protocol/errors"
import {
  Authentication,
  type AuthenticatedSession,
  CurrentSession,
  CurrentUser,
} from "@ren/protocol/middleware/authentication"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"
import { Auth } from "../auth.js"

export class McpCaller extends Context.Service<
  McpCaller,
  { readonly session: AuthenticatedSession; readonly agent?: Actor.AgentInfo["agent"] }
>()("@ren/server/McpCaller") {}

const unauthorized = new UnauthorizedError({ message: "Sign in to continue." })

const dispatched = Effect.serviceOption(McpCaller)

const replaySession = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const authenticate = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const headers = new Headers(request.headers)
      const session = yield* auth.getSession(headers)
      if (Option.isSome(session)) return session.value
      const token = yield* auth.getAccessToken(headers)
      if (Option.isNone(token)) return yield* unauthorized
      return token.value
    })
    const provideSession = Effect.fnUntraced(function* <A, E, R>(
      httpEffect: Effect.Effect<A, E, R>,
      session: AuthenticatedSession,
    ) {
      const replay = (yield* HttpServerRequest.HttpServerRequest).headers["x-posthog-session-id"]
      const caller = {
        "user.id": session.user.id,
        ...(session.session.activeOrganizationId && { "ren.organization.id": session.session.activeOrganizationId }),
        ...(replay && replaySession.test(replay) && { sessionId: replay }),
      }
      return yield* httpEffect.pipe(
        Effect.provideService(CurrentUser, session.user),
        Effect.provideService(CurrentSession, session),
        Effect.annotateLogs(caller),
        Effect.annotateSpans(caller),
      )
    })
    return Authentication.of({
      bearer: Effect.fn("Authentication.bearer")(function* (httpEffect, options) {
        const caller = yield* dispatched
        if (Option.isSome(caller)) return yield* provideSession(httpEffect, caller.value.session)
        if (Redacted.value(options.credential) === "") return yield* unauthorized
        const session = yield* authenticate
        return yield* provideSession(httpEffect, session)
      }),
      cookie: Effect.fn("Authentication.cookie")(function* (httpEffect) {
        const caller = yield* dispatched
        if (Option.isSome(caller)) return yield* provideSession(httpEffect, caller.value.session)
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!request.headers.cookie) return yield* unauthorized
        const session = yield* authenticate
        return yield* provideSession(httpEffect, session)
      }),
    })
  }),
)
