export * as BetterAuth from "./better-auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { BASE_ERROR_CODES, betterAuth } from "better-auth"
import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { bearer, emailOTP, organization } from "better-auth/plugins"
import { Effect, Option, Schema } from "effect"
import { AuthEmail } from "./auth-email.js"
import { DefaultOrganization } from "./default-organization.js"

export interface Input {
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
  readonly lifecycle: {
    readonly join: (organizationId: string, user: LifecycleUser) => Promise<void>
    readonly activate: (organizationId: string, user: LifecycleUser) => Promise<void>
    readonly leave: (organizationId: string, userId: string) => Promise<void>
  }
}

export interface LifecycleUser {
  readonly id: string
  readonly name: string
  readonly email: string
}

const ids = new Map<string, () => string>([
  ["user", Auth.UserID.create],
  ["session", Auth.SessionID.create],
  ["account", Auth.AccountID.create],
  ["verification", Auth.VerificationID.create],
  ["organization", Auth.OrganizationID.create],
  ["member", Auth.MemberID.create],
  ["invitation", Auth.InvitationID.create],
])

const SendableOTP = Schema.Struct({ type: Schema.Literals(["sign-in", "email-verification"]) })

const SignUp = Schema.Struct({ email: Schema.String })

const CreateOrganization = Schema.Struct({ slug: Schema.String })

const SlugConflict = Schema.Struct({
  cause: Schema.Struct({
    errno: Schema.Literal("23505"),
    constraint: Schema.Literals(["organization_slug_key", "organization_slug_uidx"]),
  }),
})

const generateId = (options: { model: string }) => {
  const generate = ids.get(options.model)
  if (!generate) throw new Error(`No ID generator registered for auth model: ${options.model}`)
  return generate()
}

const indexes = {
  id: "ren-indexes",
  schema: { account: { fields: {}, indexes: [{ fields: ["providerId", "accountId"], unique: true }] } },
} satisfies BetterAuthPlugin

const emailCodes = (input: Input) =>
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
      input.sendEmail(AuthEmail.code(data))
    },
  })

const provisionOrganization =
  (input: Input) =>
  async <Session extends { userId: string; activeOrganizationId?: string | null | undefined }>(session: Session) => {
    if (session.activeOrganizationId) return { data: session }
    const created = await DefaultOrganization.provision(input.database, session.userId)
      .then(async (result) => {
        if (result?.user) await input.lifecycle.join(result.id, result.user)
        return result
      })
      .catch(async (error) => {
        await Effect.runPromise(
          Effect.logError("Default organization provisioning failed", error).pipe(
            Effect.annotateLogs({ userId: session.userId }),
          ),
        )
      })
    return created ? { data: { ...session, activeOrganizationId: created.id } } : { data: session }
  }

const guardRequests = (input: Input) =>
  createAuthMiddleware(async (ctx) => {
    const body: unknown = ctx.body
    switch (ctx.path) {
      case "/email-otp/send-verification-otp":
        if (!Schema.is(SendableOTP)(body)) throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" })
        return
      case "/sign-up/email": {
        if (!Schema.is(SignUp)(body)) return
        const rejection = await input.signupGuard.checkEmailSignUp(body.email)
        if (Option.isSome(rejection)) throw new APIError("BAD_REQUEST", rejection.value)
        return
      }
      case "/organization/create":
        if (!Schema.is(CreateOrganization)(body)) return
        return { context: { body: { ...body, slug: DefaultOrganization.slugify(body.slug) } } }
      default:
        return
    }
  })

const guardAccountCreation =
  (input: Input) =>
  async <User extends { email: string }>(user: User, ctx: { path?: string } | null | undefined) => {
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
  }

export const make = (input: Input) => {
  const appURL = `${input.appURL.replace(/\/$/, "")}/`
  const organizationPlugin = organization({
    invitationExpiresIn: 60 * 60 * 24 * 7,
    requireEmailVerificationOnInvitation: false,
    organizationHooks: {
      afterAddMember: (data) => input.lifecycle.join(data.organization.id, data.user),
      afterAcceptInvitation: async (data) => {
        await input.lifecycle.join(data.organization.id, data.user)
        if (data.user.emailVerified) await input.lifecycle.activate(data.organization.id, data.user)
      },
      afterRemoveMember: (data) => input.lifecycle.leave(data.organization.id, data.user.id),
    },
    sendInvitationEmail: async (data) => {
      const url = new URL("signup", appURL)
      url.searchParams.set("invitationId", data.invitation.id)
      input.sendEmail(AuthEmail.invitation(data.email, url))
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
        input.sendEmail(AuthEmail.resetPassword(data.user.email, url))
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 90 },
    emailVerification: { sendOnSignIn: true, autoSignInAfterVerification: true },
    hooks: { before: guardRequests(input) },
    socialProviders: {
      google: { clientId: input.google.clientId, clientSecret: input.google.clientSecret },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    databaseHooks: {
      user: { create: { before: guardAccountCreation(input) } },
      session: { create: { before: provisionOrganization(input) } },
    },
    plugins: [bearer(), emailCodes(input), organizationPlugin, indexes],
    advanced: {
      // oxlint-disable-next-line ren/no-comments -- Better Auth skips the origin check when NODE_ENV is "test"; keep it on so tests match production
      disableOriginCheck: false,
      database: { generateId },
    },
  })
}

export type Instance = ReturnType<typeof make>
