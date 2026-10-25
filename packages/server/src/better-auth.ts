export * as BetterAuth from "./better-auth.js"

import { cimd } from "@better-auth/cimd"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { mcp } from "@better-auth/mcp"
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider"
import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import type { SpaceProvisioning } from "@ren/core/space/provisioning"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { BASE_ERROR_CODES, betterAuth } from "better-auth"
import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { bearer, emailOTP, jwt, organization } from "better-auth/plugins"
import { Effect, Option, Schema } from "effect"
import { AuthEmail } from "./auth-email.js"
import { DefaultOrganization } from "./default-organization.js"
import { OrganizationAccess } from "./organization-access.js"

export interface Input {
  readonly database: AuthDatabase.Interface["db"]
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly google: { readonly clientId: string; readonly clientSecret: string }
  readonly appURL: string
  readonly requireEmailVerification: boolean
  readonly mcpResource: string
  readonly fetchClientMetadataResource: ClientMetadataResourceFetch
  readonly sendEmail: (email: Mailer.Email) => void
  readonly signupGuard: {
    readonly checkEmailSignUp: (email: string) => Promise<Option.Option<SignupGuard.Rejection>>
    readonly checkAccountCreation: (email: string) => Promise<Option.Option<SignupGuard.Rejection>>
    readonly hasVerifiedAlias: (email: string) => Promise<boolean>
  }
  readonly provisioning: {
    readonly createInitialMemberships: (organizationId: string, user: ProvisioningUser) => Promise<void>
    readonly activatePendingMemberships: (organizationId: string, user: ProvisioningUser) => Promise<void>
    readonly archiveMemberships: (organizationId: string, userId: string) => Promise<void>
    readonly forgetInferenceMember: (organizationId: string, userId: string, memberId: string) => Promise<void>
  }
}

export type ProvisioningUser = Omit<SpaceProvisioning.User, "id"> & { readonly id: string }

const ids = new Map<string, () => string>([
  ["user", Auth.UserID.create],
  ["session", Auth.SessionID.create],
  ["account", Auth.AccountID.create],
  ["verification", Auth.VerificationID.create],
  ["organization", Auth.OrganizationID.create],
  ["member", Auth.MemberID.create],
  ["invitation", Auth.InvitationID.create],
  ["jwks", Auth.JwkID.create],
  ["oauthClient", Auth.OAuthClientID.create],
  ["oauthResource", Auth.OAuthResourceID.create],
  ["oauthClientResource", Auth.OAuthClientResourceID.create],
  ["oauthRefreshToken", Auth.OAuthRefreshTokenID.create],
  ["oauthAccessToken", Auth.OAuthAccessTokenID.create],
  ["oauthConsent", Auth.OAuthConsentID.create],
  ["oauthClientAssertion", Auth.OAuthClientAssertionID.create],
])

export const mcpScope = "ren"

export const organizationClaim = "ren_org"

const ActiveOrganization = Schema.Struct({ activeOrganizationId: Schema.String })

// oxlint-disable-next-line ren/no-comments -- @better-auth/oauth-provider types its OpenAPI parameters with `items?: undefined`, which exactOptionalPropertyTypes refuses as a BetterAuthPlugin; the value is a valid plugin.
const oauthPlugin = (plugin: ReturnType<typeof mcp> | ReturnType<typeof cimd>) =>
  // ast-grep-ignore: no-chained-type-assertions, -- the value is a valid plugin; only the published type is wrong
  plugin as unknown as BetterAuthPlugin // oxlint-disable-line typescript/no-unsafe-type-assertion -- see the reason above

const signUpPath = "/sign-up/email"

const SignUp = Schema.Struct({ email: Schema.String })

const CreateOrganization = Schema.Struct({ slug: Schema.String })

const AcceptedConsent = Schema.Struct({ accept: Schema.Literal(true) })

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
    expiresIn: AuthEmail.otpExpirySeconds,
    allowedAttempts: 5,
    storeOTP: "hashed",
    sendVerificationOTP: async (data) => {
      if (!Schema.is(AuthEmail.OTP)(data)) return
      if (data.type === "email-verification") {
        const user = await input.database.query.user.findFirst({
          columns: { emailVerified: true },
          where: { email: Auth.normalizeEmail(data.email) },
        })
        if (user?.emailVerified) return
      }
      input.sendEmail(AuthEmail.code(data))
    },
  })

const logFailure = (message: string, error: unknown, userId: string) =>
  Effect.runPromise(Effect.logError(message, error).pipe(Effect.annotateLogs({ userId })))

const provisionOrganization =
  (input: Input) =>
  async <Session extends { userId: string; activeOrganizationId?: string | null | undefined }>(session: Session) => {
    if (session.activeOrganizationId) return { data: session }
    const organization = await DefaultOrganization.provision(input.database, session.userId).catch((error: unknown) =>
      logFailure("Default organization provisioning failed", error, session.userId),
    )
    if (!organization) return { data: session }
    if (organization.user) {
      await input.provisioning
        .createInitialMemberships(organization.id, organization.user)
        .catch((error: unknown) => logFailure("Space provisioning failed", error, session.userId))
    }
    return { data: { ...session, activeOrganizationId: organization.id } }
  }

const guardRequests = (input: Input) =>
  createAuthMiddleware(async (ctx) => {
    const body: unknown = ctx.body
    switch (ctx.path) {
      case "/email-otp/send-verification-otp":
        if (!Schema.is(AuthEmail.OTP)(body)) throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" })
        return
      case signUpPath: {
        if (!Schema.is(SignUp)(body)) return
        const rejection = await input.signupGuard.checkEmailSignUp(body.email)
        if (Option.isSome(rejection)) throw new APIError("BAD_REQUEST", rejection.value)
        return
      }
      case "/organization/create":
        if (!Schema.is(CreateOrganization)(body)) return
        return { context: { body: { ...body, slug: Auth.organizationSlug(body.slug) } } }
      default:
        return
    }
  })

const consentOrganization = (input: Input) =>
  ({
    id: "ren-consent-organization",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/consent" && Schema.is(AcceptedConsent)(ctx.body),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx)
            if (!session) return
            const organizationId = ctx.headers?.get(Auth.consentOrganizationHeader) ?? ""
            const member = await input.database.query.member.findFirst({
              columns: { id: true },
              where: { userId: session.user.id, organizationId },
            })
            if (!member) throw new APIError("FORBIDDEN", { message: "Choose an organization that you belong to." })
            return {
              context: {
                context: {
                  session: { ...session, session: { ...session.session, activeOrganizationId: organizationId } },
                },
              },
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin

const guardAccountCreation =
  (input: Input) =>
  async <User extends { email: string }>(user: User, ctx: { path?: string } | null | undefined) => {
    if (ctx?.path === signUpPath) {
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
    ac: OrganizationAccess.control,
    roles: OrganizationAccess.roles,
    invitationExpiresIn: 60 * 60 * 24 * 7,
    requireEmailVerificationOnInvitation: false,
    organizationHooks: {
      afterAddMember: (data) => input.provisioning.createInitialMemberships(data.organization.id, data.user),
      afterAcceptInvitation: async (data) => {
        await input.provisioning.createInitialMemberships(data.organization.id, data.user)
        await input.provisioning.activatePendingMemberships(data.organization.id, data.user)
      },
      afterRemoveMember: async (data) => {
        await input.provisioning.archiveMemberships(data.organization.id, data.user.id)
        await input.provisioning.forgetInferenceMember(data.organization.id, data.user.id, data.member.id)
      },
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
    basePath: "/auth",
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
      google: {
        clientId: input.google.clientId,
        clientSecret: input.google.clientSecret,
        requireEmailVerification: true,
      },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    databaseHooks: {
      user: { create: { before: guardAccountCreation(input) } },
      session: { create: { before: provisionOrganization(input) } },
    },
    plugins: [
      bearer(),
      emailCodes(input),
      organizationPlugin,
      jwt({ disableSettingJwtHeader: true }),
      oauthPlugin(
        mcp({
          resource: input.mcpResource,
          loginPage: new URL("login", appURL).href,
          consentPage: new URL("consent", appURL).href,
          signup: { page: new URL("signup", appURL).href },
          scopes: ["openid", "profile", "email", "offline_access", mcpScope],
          accessTokenExpiresIn: 60 * 60,
          refreshTokenExpiresIn: 60 * 60 * 24 * 30,
          postLogin: {
            page: new URL("consent", appURL).href,
            shouldRedirect: () => false,
            consentReferenceId: (context) =>
              Schema.decodeUnknownOption(ActiveOrganization)(context.session).pipe(
                Option.map((session) => session.activeOrganizationId),
                Option.getOrUndefined,
              ),
          },
          customAccessTokenClaims: (info) => (info.referenceId ? { [organizationClaim]: info.referenceId } : {}),
        }),
      ),
      oauthPlugin(
        cimd({
          fetchClientMetadataResource: input.fetchClientMetadataResource,
          metadataProfile: "mcp-2026-07-28",
        }),
      ),
      consentOrganization(input),
      indexes,
    ],
    advanced: {
      // oxlint-disable-next-line ren/no-comments -- Better Auth skips the origin check when NODE_ENV is "test"; keep it on so tests match production
      disableOriginCheck: false,
      database: { generateId },
    },
  })
}
