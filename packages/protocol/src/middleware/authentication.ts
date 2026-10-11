import { Auth } from "@ren/schema/auth"
import { Context } from "effect"
import { HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { UnauthorizedError } from "../errors.js"

export class CurrentUser extends Context.Service<CurrentUser, Auth.User>()("@ren/protocol/CurrentUser") {}

export interface AuthenticatedSession {
  readonly user: Auth.User
  readonly session: { readonly activeOrganizationId?: string | null }
}

export class CurrentSession extends Context.Service<CurrentSession, AuthenticatedSession>()(
  "@ren/protocol/CurrentSession",
) {}

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser | CurrentSession }
>()("@ren/protocol/Authentication", {
  error: UnauthorizedError,
  security: {
    bearer: HttpApiSecurity.bearer.pipe(
      HttpApiSecurity.annotate(OpenApi.Description, "A Better Auth session token, for the CLI and SDK."),
    ),
    cookie: HttpApiSecurity.apiKey({ key: "better-auth.session_token", in: "cookie" }).pipe(
      HttpApiSecurity.annotate(
        OpenApi.Description,
        "The Better Auth session cookie, for browsers. Named `__Secure-better-auth.session_token` over HTTPS.",
      ),
    ),
  },
}) {}
