export * as Auth from "./auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { AuthDatabase } from "@ren/db/auth-database"
import { Auth } from "@ren/schema/auth"
import { Identifier } from "@ren/schema/identifier"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { bearer, emailOTP, organization } from "better-auth/plugins"
import { eq, like, or } from "drizzle-orm"
import freeEmailDomains from "free-email-domains"
import { Config, Context, Effect, FiberSet, Layer, Option, Redacted, Schema } from "effect"
import { getDomainWithoutSuffix } from "tldts"
import { Mailer } from "./mailer.js"

export interface Input {
  readonly database: AuthDatabase.Interface["db"]
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly google: { readonly clientId: string; readonly clientSecret: string }
  readonly appURL: string
  readonly requireEmailVerification: boolean
  readonly sendEmail: (email: Mailer.Email) => void
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

const freemail = new Set([...freeEmailDomains, "duckduckgo.com", "tutanota.com", "tutamail.com", "tuta.io", "hey.com"])

export const make = (input: Input) => {
  const uniqueSlug = async (base: string) => {
    const root =
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "organization"
    const rows = await input.database
      .select({ slug: AuthDatabase.Schema.organization.slug })
      .from(AuthDatabase.Schema.organization)
      .where(
        or(eq(AuthDatabase.Schema.organization.slug, root), like(AuthDatabase.Schema.organization.slug, `${root}-%`)),
      )
    const taken = new Set(rows.map((row) => row.slug))
    const candidates = [root, ...Array.from({ length: taken.size }, (_, index) => `${root}-${index + 2}`)]
    return candidates.find((candidate) => !taken.has(candidate)) ?? root
  }

  const auth = betterAuth({
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
    database: drizzleAdapter(input.database, { provider: "pg", schema: AuthDatabase.Schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: input.requireEmailVerification,
      sendResetPassword: async (data) => {
        const url = new URL("reset-password", `${input.appURL.replace(/\/$/, "")}/`)
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
        if (ctx.path !== "/email-otp/send-verification-otp") return
        if (!Schema.is(SendableOTP)(ctx.body)) throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" })
      }),
    },
    socialProviders: {
      google: { clientId: input.google.clientId, clientSecret: input.google.clientSecret },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session): Promise<{ data: typeof session }> => {
            if (session.activeOrganizationId) return { data: session }
            const membership = await input.database.query.member.findFirst({
              columns: { organizationId: true },
              where: { userId: session.userId },
              orderBy: { createdAt: "asc", id: "asc" },
            })
            if (membership) return { data: { ...session, activeOrganizationId: membership.organizationId } }
            const user = await input.database.query.user.findFirst({ where: { id: session.userId } })
            if (!user) return { data: session }
            const invitation = await input.database.query.invitation.findFirst({
              columns: { id: true },
              where: { email: user.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
            })
            if (invitation) return { data: session }
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
            const created = await uniqueSlug(name)
              .then((slug) => auth.api.createOrganization({ body: { userId: user.id, name, slug } }))
              .catch(() => undefined)
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
      organization({
        invitationExpiresIn: 60 * 60 * 24 * 7,
        requireEmailVerificationOnInvitation: false,
        organizationHooks: {
          beforeCreateOrganization: async (data) => ({
            data: { slug: await uniqueSlug(data.organization.slug || data.organization.name || "") },
          }),
        },
      }),
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
        generateId: (options) => (Object.hasOwn(ids, options.model) ? ids[options.model]() : Identifier.ulid()),
      },
    },
  })
  return auth
}

export interface Interface {
  readonly handler: (request: Request) => Promise<Response>
  readonly trustedOrigins: ReadonlyArray<string>
  readonly getUser: (headers: Headers) => Effect.Effect<Option.Option<Auth.User>>
  readonly getActiveOrganization: (headers: Headers) => Effect.Effect<Option.Option<Auth.Organization>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* AuthDatabase.Service
    const mailer = yield* Mailer.Service
    const run = yield* FiberSet.makeRuntime()
    const config = yield* Config.all({
      secret: Config.Redacted("BETTER_AUTH_SECRET"),
      baseURL: Config.String("BETTER_AUTH_URL"),
      trustedOrigins: Config.Array(Schema.String, "TRUSTED_ORIGINS").pipe(Config.withDefault([])),
      googleClientId: Config.String("GOOGLE_CLIENT_ID"),
      googleClientSecret: Config.Redacted("GOOGLE_CLIENT_SECRET"),
      appURL: Config.String("APP_URL"),
      skipEmailVerification: Config.Boolean("SKIP_EMAIL_VERIFICATION").pipe(Config.withDefault(false)),
      nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
    })
    if (config.skipEmailVerification && config.nodeEnv === "production") {
      return yield* Effect.die(new Error("SKIP_EMAIL_VERIFICATION cannot be enabled in production"))
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
    })
    return Service.of({
      handler: auth.handler,
      trustedOrigins: config.trustedOrigins,
      getUser: Effect.fn("Auth.getUser")(function* (headers: Headers) {
        const session = yield* Effect.promise(() => auth.api.getSession({ headers }))
        if (!session) return Option.none()
        const user: typeof Auth.User.Encoded = session.user
        return Option.some(yield* Schema.decodeEffect(Auth.User)(user).pipe(Effect.orDie))
      }),
      getActiveOrganization: Effect.fn("Auth.getActiveOrganization")(function* (headers: Headers) {
        const session = yield* Effect.promise(() => auth.api.getSession({ headers }))
        if (!session) return Option.none()
        const organizations = (yield* Effect.promise(() =>
          database.db.query.member.findMany({
            columns: {},
            with: { organization: { columns: { id: true, name: true, slug: true, logo: true } } },
            where: { userId: session.user.id },
            orderBy: { createdAt: "asc", id: "asc" },
          }),
        )).flatMap((row) => (row.organization ? [row.organization] : []))
        const active = organizations.find((row) => row.id === session.session.activeOrganizationId) ?? organizations[0]
        if (!active) return Option.none()
        const organization: typeof Auth.Organization.Encoded = active
        return Option.some(yield* Schema.decodeEffect(Auth.Organization)(organization).pipe(Effect.orDie))
      }),
    })
  }),
)
