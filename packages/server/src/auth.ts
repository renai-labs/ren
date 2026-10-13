export * as Auth from "./auth.js"

import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import { SpaceProvisioning } from "@ren/core/space/provisioning"
import { AuthDatabase } from "@ren/db/auth-database"
import { type AuthenticatedSession } from "@ren/protocol/middleware/authentication"
import { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/util/environment"
import { Config, Context, Effect, FiberSet, Layer, Option, Redacted, Schema } from "effect"
import { BetterAuth } from "./better-auth.js"

interface Interface {
  readonly handler: (request: Request) => Promise<Response>
  readonly trustedOrigins: ReadonlyArray<string>
  readonly getSession: (headers: Headers) => Effect.Effect<Option.Option<AuthenticatedSession>>
  readonly getActiveOrganization: (
    session: AuthenticatedSession,
    headers: Headers,
  ) => Effect.Effect<Option.Option<Auth.Organization>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/server/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* AuthDatabase.Service
    const mailer = yield* Mailer.Service
    const signupGuard = yield* SignupGuard.Service
    const provisioning = yield* SpaceProvisioning.Service
    const toProvisioningUser = (user: BetterAuth.ProvisioningUser) => ({ ...user, id: Auth.UserID.make(user.id) })
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
    const auth = BetterAuth.make({
      database: database.db,
      secret: Redacted.value(config.secret),
      baseURL: config.baseURL,
      trustedOrigins: config.trustedOrigins,
      google: { clientId: config.googleClientId, clientSecret: Redacted.value(config.googleClientSecret) },
      appURL: config.appURL,
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
      getActiveOrganization: Effect.fn("Auth.getActiveOrganization")(function* (
        session: AuthenticatedSession,
        headers: Headers,
      ) {
        const membership = yield* Effect.promise(() =>
          database.db.query.member.findFirst({
            columns: {},
            with: { organization: { columns: { id: true, name: true, slug: true, logo: true } } },
            where: { userId: session.user.id },
            orderBy: (member, { asc, desc, sql }) => [
              desc(sql`${member.organizationId} is not distinct from ${session.session.activeOrganizationId}`),
              asc(member.createdAt),
              asc(member.id),
            ],
          }),
        )
        const active = membership?.organization
        if (!active) return Option.none()
        if (active.id !== session.session.activeOrganizationId) {
          yield* Effect.promise(() => auth.api.setActiveOrganization({ headers, body: { organizationId: active.id } }))
        }
        const organization: typeof Auth.Organization.Encoded = active
        return Option.some(yield* Schema.decodeEffect(Auth.Organization)(organization).pipe(Effect.orDie))
      }),
    })
  }),
).pipe(Layer.provide(SpaceProvisioning.layer))
