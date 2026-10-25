export * as Auth from "./auth.js"

import { fetchClientMetadataResource } from "@better-auth/cimd/node"
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider"
import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import { SpaceProvisioning } from "@ren/core/space/provisioning"
import { AuthDatabase } from "@ren/db/auth-database"
import { type AuthenticatedSession } from "@ren/protocol/middleware/authentication"
import { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/util/environment"
import { verifyJwsAccessToken } from "better-auth/oauth2"
import { Config, Context, Effect, FiberSet, Layer, Option, Redacted, Schema } from "effect"
import { BetterAuth } from "./better-auth.js"

interface Interface {
  readonly handler: (request: Request) => Promise<Response>
  readonly trustedOrigins: ReadonlyArray<string>
  readonly getSession: (headers: Headers) => Effect.Effect<Option.Option<AuthenticatedSession>>
  readonly getAccessToken: (headers: Headers) => Effect.Effect<Option.Option<AuthenticatedSession>>
  readonly actAs: (caller: Caller) => Effect.Effect<Option.Option<AuthenticatedSession>>
  readonly mcpChallenge: string
  readonly getActiveMembership: (
    session: AuthenticatedSession,
    headers: Headers,
  ) => Effect.Effect<Option.Option<Membership>>
}

interface Caller {
  readonly userId: string
  readonly organizationId: string
}

interface Membership {
  readonly organization: Auth.Organization
  readonly roles: ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@ren/server/Auth") {}

export const ClientMetadataFetch = Context.Reference<ClientMetadataResourceFetch>(
  "@ren/server/Auth/ClientMetadataFetch",
  {
    defaultValue: () => fetchClientMetadataResource,
  },
)

export const mcpPath = "/mcp"

export const consentOrganizationHeader = Auth.consentOrganizationHeader

const AccessToken = Schema.Struct({
  sub: Auth.UserID,
  [BetterAuth.organizationClaim]: Auth.OrganizationID,
  scope: Schema.String,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* AuthDatabase.Service
    const mailer = yield* Mailer.Service
    const signupGuard = yield* SignupGuard.Service
    const provisioning = yield* SpaceProvisioning.Service
    const toProvisioningUser = (user: BetterAuth.ProvisioningUser) => ({ ...user, id: Auth.UserID.make(user.id) })
    const clientMetadataFetch = yield* ClientMetadataFetch
    const run = yield* FiberSet.makeRuntime()
    const runPromise = yield* FiberSet.makeRuntimePromise()
    const config = yield* Config.all({
      secret: Config.Redacted("BETTER_AUTH_SECRET"),
      baseURL: Config.String("BETTER_AUTH_URL"),
      trustedOrigins: Config.Array(Schema.String, "TRUSTED_ORIGINS").pipe(Config.withDefault([])),
      googleClientId: Config.String("GOOGLE_CLIENT_ID"),
      googleClientSecret: Config.Redacted("GOOGLE_CLIENT_SECRET"),
      appURL: Config.String("APP_URL"),
      skipEmailVerification: Config.Boolean("SKIP_EMAIL_VERIFICATION").pipe(Config.withDefault(false)),
      local: Environment.local,
    })
    if (config.skipEmailVerification && !config.local) {
      return yield* Effect.die(new Error("SKIP_EMAIL_VERIFICATION requires NODE_ENV=development or test"))
    }
    const mcpResource = new URL(mcpPath, config.baseURL).href
    const auth = BetterAuth.make({
      database: database.db,
      secret: Redacted.value(config.secret),
      baseURL: config.baseURL,
      trustedOrigins: config.trustedOrigins,
      google: { clientId: config.googleClientId, clientSecret: Redacted.value(config.googleClientSecret) },
      appURL: config.appURL,
      mcpResource,
      fetchClientMetadataResource: clientMetadataFetch,
      requireEmailVerification: !config.skipEmailVerification,
      sendEmail: (email) => {
        run(mailer.send(email).pipe(Effect.ignoreCause({ log: "Error", message: "Failed to send email" })))
      },
      signupGuard: {
        checkEmailSignUp: (email) => runPromise(signupGuard.checkEmailSignUp(email)),
        checkAccountCreation: (email) => runPromise(signupGuard.checkAccountCreation(email)),
        hasVerifiedAlias: (email) => runPromise(signupGuard.hasVerifiedAlias(email)),
      },
      provisioning: {
        createInitialMemberships: (organizationId, user) =>
          runPromise(
            provisioning.createInitialMemberships(Auth.OrganizationID.make(organizationId), toProvisioningUser(user)),
          ),
        activatePendingMemberships: (organizationId, user) =>
          runPromise(
            provisioning.activatePendingMemberships(Auth.OrganizationID.make(organizationId), toProvisioningUser(user)),
          ),
        archiveMemberships: (organizationId, userId) =>
          runPromise(
            provisioning.archiveMemberships(Auth.OrganizationID.make(organizationId), Auth.UserID.make(userId)),
          ),
      },
    })
    const context = yield* Effect.promise(() => auth.$context)
    const jwksCache = {}
    const actAs = Effect.fn("Auth.actAs")(function* (caller: Caller) {
      const member = yield* Effect.promise(() =>
        database.db.query.member.findFirst({
          columns: {},
          with: { user: { columns: { id: true, name: true, email: true, emailVerified: true, image: true } } },
          where: { userId: caller.userId, organizationId: caller.organizationId },
        }),
      )
      if (!member?.user) return Option.none<AuthenticatedSession>()
      const user: typeof Auth.User.Encoded = member.user
      return Option.some<AuthenticatedSession>({
        user: yield* Schema.decodeEffect(Auth.User)(user).pipe(Effect.orDie),
        session: { activeOrganizationId: caller.organizationId, fixedOrganization: true },
      })
    })
    return Service.of({
      handler: auth.handler,
      trustedOrigins: config.trustedOrigins,
      getSession: Effect.fn("Auth.getSession")(function* (headers: Headers) {
        const session = yield* Effect.promise(() => auth.api.getSession({ headers }))
        if (!session) return Option.none()
        const user: typeof Auth.User.Encoded = session.user
        return Option.some({
          user: yield* Schema.decodeEffect(Auth.User)(user).pipe(Effect.orDie),
          session: { activeOrganizationId: session.session.activeOrganizationId ?? null },
        })
      }),
      getAccessToken: Effect.fn("Auth.getAccessToken")(function* (headers: Headers) {
        const token = /^Bearer\s+(\S+)$/iu.exec(headers.get("authorization") ?? "")?.at(1)
        if (!token) return Option.none()
        const payload = yield* Effect.tryPromise(() =>
          verifyJwsAccessToken(token, {
            jwksFetch: () => auth.api.getJwks(),
            jwksCacheKey: jwksCache,
            verifyOptions: { issuer: context.baseURL, audience: mcpResource },
          }),
        ).pipe(Effect.option)
        if (Option.isNone(payload) || "cnf" in payload.value) return Option.none()
        const claims = Schema.decodeUnknownOption(AccessToken)(payload.value)
        if (Option.isNone(claims) || !claims.value.scope.split(" ").includes(BetterAuth.mcpScope)) return Option.none()
        return yield* actAs({ userId: claims.value.sub, organizationId: claims.value[BetterAuth.organizationClaim] })
      }),
      actAs,
      mcpChallenge: `Bearer resource_metadata="${new URL(`/.well-known/oauth-protected-resource${mcpPath}`, config.baseURL).href}", scope="${BetterAuth.mcpScope}"`,
      getActiveMembership: Effect.fn("Auth.getActiveMembership")(function* (
        session: AuthenticatedSession,
        headers: Headers,
      ) {
        const membership = yield* Effect.promise(() =>
          database.db.query.member.findFirst({
            columns: { role: true },
            with: { organization: { columns: { id: true, name: true, slug: true, logo: true } } },
            where: session.session.fixedOrganization
              ? { userId: session.user.id, organizationId: session.session.activeOrganizationId ?? "" }
              : { userId: session.user.id },
            orderBy: (member, { asc, desc, sql }) => [
              desc(sql`${member.organizationId} is not distinct from ${session.session.activeOrganizationId}`),
              asc(member.createdAt),
              asc(member.id),
            ],
          }),
        )
        const active = membership?.organization
        if (!membership || !active) return Option.none()
        if (active.id !== session.session.activeOrganizationId) {
          yield* Effect.promise(() => auth.api.setActiveOrganization({ headers, body: { organizationId: active.id } }))
        }
        const organization: typeof Auth.Organization.Encoded = active
        return Option.some({
          organization: yield* Schema.decodeEffect(Auth.Organization)(organization).pipe(Effect.orDie),
          roles: Auth.roles(membership.role),
        })
      }),
    })
  }),
).pipe(Layer.provide(SpaceProvisioning.layer))
