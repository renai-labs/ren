export * as Auth from "./auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { type AuthenticatedSession } from "@ren/protocol/middleware/authentication"
import { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/util/environment"
import { BASE_ERROR_CODES, betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { bearer, emailOTP, organization } from "better-auth/plugins"
import { eq, like, or } from "drizzle-orm"
import freeEmailDomains from "free-email-domains"
import { Config, Context, Effect, FiberSet, Layer, Option, Redacted, Schema } from "effect"
import { getDomainWithoutSuffix } from "tldts"

interface Input {
  readonly database: AuthDatabase.Interface["db"]
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly google: { readonly clientId: string; readonly clientSecret: string }
  readonly appURL: string
  readonly requireEmailVerification: boolean
  readonly sendEmail: (email: Mailer.Email) => void
  readonly signupGuard: {
    readonly checkEmailSignUp: (email: string) => Promise<Option.Option<SignupGuard.Rejection>>
    readonly checkAccountCreation: (email: string) => Promise<Option.Option<SignupGuard.Rejection>>
    readonly hasVerifiedAlias: (email: string) => Promise<boolean>
  }
}

const ids: Record<string, () => string> = {
  user: Auth.UserID.create,
  session: Auth.SessionID.create,
  account: Auth.AccountID.create,
  verification: Auth.VerificationID.create,
  organization: Auth.OrganizationID.create,
  member: Auth.MemberID.create,
  invitation: Auth.InvitationID.create,
}

const SendableOTP = Schema.Struct({ type: Schema.Literals(["sign-in", "email-verification"]) })

const SignUp = Schema.Struct({ email: Schema.String })

const CreateOrganization = Schema.Struct({ slug: Schema.String })

const SlugConflict = Schema.Struct({
  cause: Schema.Struct({
    errno: Schema.Literal("23505"),
    constraint: Schema.Literals(["organization_slug_key", "organization_slug_uidx"]),
  }),
})

const freemail = new Set([...freeEmailDomains, "duckduckgo.com", "tutanota.com", "tutamail.com", "tuta.io", "hey.com"])

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

export const make = (input: Input) => {
  const appURL = `${input.appURL.replace(/\/$/, "")}/`
  const organizationPlugin = organization({
    invitationExpiresIn: 60 * 60 * 24 * 7,
    requireEmailVerificationOnInvitation: false,
    sendInvitationEmail: async (data) => {
      const url = new URL("signup", appURL)
      url.searchParams.set("invitationId", data.invitation.id)
      input.sendEmail({
        to: data.email,
        sender: "invitations",
        subject: "You have been invited to join a Ren organization",
        text: `You have been invited to join a Ren organization. Please click on the link below to accept the invitation. ${url}`,
      })
    },
  })
  return betterAuth({
    appName: "Ren",
    secret: input.secret,
    baseURL: input.baseURL,
    basePath: "/api/auth",
    disabledPaths: [
      "/organization/leave",
      "/email-otp/check-verification-otp",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    trustedOrigins: [...input.trustedOrigins],
    database: (options) => {
      const adapter = drizzleAdapter(input.database, { provider: "pg", schema: Database.Schema })(options)
      return {
        ...adapter,
        create: <T extends Record<string, unknown>, R = T>(args: Parameters<typeof adapter.create<T, R>>[0]) =>
          adapter.create<T, R>(args).catch((error: unknown) => {
            if (args.model === "organization" && Schema.is(SlugConflict)(error)) {
              throw APIError.from("BAD_REQUEST", organizationPlugin.$ERROR_CODES.ORGANIZATION_SLUG_ALREADY_TAKEN)
            }
            throw error
          }),
      }
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: input.requireEmailVerification,
      sendResetPassword: async (data) => {
        const url = new URL("reset-password", appURL)
        url.searchParams.set("token", data.token)
        input.sendEmail({
          to: data.user.email,
          subject: "Reset your Ren password",
          text: `Please click on the link below to reset your Ren password. ${url}`,
        })
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 90 },
    emailVerification: { sendOnSignIn: true, autoSignInAfterVerification: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        switch (ctx.path) {
          case "/email-otp/send-verification-otp":
            if (!Schema.is(SendableOTP)(ctx.body)) throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" })
            return
          case "/sign-up/email": {
            if (!Schema.is(SignUp)(ctx.body)) return
            const rejection = await input.signupGuard.checkEmailSignUp(ctx.body.email)
            if (Option.isSome(rejection)) throw new APIError("BAD_REQUEST", rejection.value)
            return
          }
          case "/organization/create":
            if (!Schema.is(CreateOrganization)(ctx.body)) return
            return { context: { body: { ...ctx.body, slug: slugify(ctx.body.slug) } } }
        }
      }),
    },
    socialProviders: {
      google: { clientId: input.google.clientId, clientSecret: input.google.clientSecret },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (ctx?.path === "/sign-up/email") {
              if (await input.signupGuard.hasVerifiedAlias(user.email)) {
                throw APIError.from(
                  input.requireEmailVerification ? "FORBIDDEN" : "UNPROCESSABLE_ENTITY",
                  BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL,
                )
              }
              return { data: user }
            }
            const rejection = await input.signupGuard.checkAccountCreation(user.email)
            if (Option.isSome(rejection)) throw new APIError("BAD_REQUEST", rejection.value)
            return { data: user }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            if (session.activeOrganizationId) return { data: session }
            const created = await input.database
              .transaction(async (tx) => {
                const [user] = await tx
                  .select()
                  .from(Database.Schema.user)
                  .where(eq(Database.Schema.user.id, session.userId))
                  .for("update")
                if (!user) return undefined
                const membership = await tx.query.member.findFirst({
                  columns: { organizationId: true },
                  where: { userId: user.id },
                  orderBy: { createdAt: "asc", id: "asc" },
                })
                if (membership) return { id: membership.organizationId }
                const invitation = await tx.query.invitation.findFirst({
                  columns: { id: true },
                  where: { email: user.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
                })
                if (invitation) return undefined
                const domain = user.email.slice(user.email.lastIndexOf("@") + 1).toLowerCase()
                const company = freemail.has(domain)
                  ? ""
                  : (getDomainWithoutSuffix(domain) ?? "")
                      .split(/[-.]+/)
                      .filter(Boolean)
                      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(" ")
                const firstName = user.name.trim().split(/\s+/)[0]
                const name = company || (firstName ? `${firstName}'s Org` : "Personal Org")
                const base = slugify(name) || "organization"
                const taken = new Set(
                  (
                    await tx
                      .select({ slug: Database.Schema.organization.slug })
                      .from(Database.Schema.organization)
                      .where(
                        or(
                          eq(Database.Schema.organization.slug, base),
                          like(Database.Schema.organization.slug, `${base}-%`),
                        ),
                      )
                  ).map((row) => row.slug),
                )
                const slug =
                  [base, ...Array.from({ length: taken.size }, (_, index) => `${base}-${index + 2}`)].find(
                    (candidate) => !taken.has(candidate),
                  ) ?? `${base}-${taken.size + 2}`
                const id = Auth.OrganizationID.create()
                const createdAt = new Date()
                await tx.insert(Database.Schema.organization).values({ id, name, slug, createdAt })
                await tx
                  .insert(Database.Schema.member)
                  .values({ id: Auth.MemberID.create(), organizationId: id, userId: user.id, role: "owner", createdAt })
                return { id }
              })
              .catch(async (error) => {
                await Effect.runPromise(
                  Effect.logError("Default organization provisioning failed", error).pipe(
                    Effect.annotateLogs({ userId: session.userId }),
                  ),
                )
                return undefined
              })
            return created ? { data: { ...session, activeOrganizationId: created.id } } : { data: session }
          },
        },
      },
    },
    plugins: [
      bearer(),
      emailOTP({
        overrideDefaultEmailVerification: true,
        disableSignUp: true,
        otpLength: 6,
        expiresIn: 60 * 10,
        allowedAttempts: 5,
        storeOTP: "hashed",
        sendVerificationOTP: async (data) => {
          if (!Schema.is(SendableOTP)(data)) return
          if (data.type === "email-verification") {
            const user = await input.database.query.user.findFirst({
              columns: { emailVerified: true },
              where: { email: data.email.toLowerCase() },
            })
            if (user?.emailVerified) return
          }
          const purpose = data.type === "sign-in" ? "sign-in" : "verification"
          input.sendEmail({
            to: data.email,
            subject: `${data.otp} is your Ren ${purpose} code`,
            text: `Use ${data.otp} to ${data.type === "sign-in" ? "sign in" : "verify your email"} on Ren. The code expires in 10 minutes. If you didn't request it, you can ignore this email.`,
          })
        },
      }),
      organizationPlugin,
      {
        id: "ren-indexes",
        schema: {
          account: {
            fields: {},
            indexes: [{ fields: ["providerId", "accountId"], unique: true }],
          },
        },
      },
    ],
    advanced: {
      // Better Auth skips the origin check when NODE_ENV is "test"; keep it on so tests match production.
      disableOriginCheck: false,
      database: {
        generateId: (options) => {
          if (!Object.hasOwn(ids, options.model)) {
            throw new Error(`No ID generator registered for auth model: ${options.model}`)
          }
          return ids[options.model]()
        },
      },
    },
  })
}

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
    const auth = make({
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
          session: { activeOrganizationId: session.session.activeOrganizationId },
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
)
