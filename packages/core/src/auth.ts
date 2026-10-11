export * as Auth from "./auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { AuthDatabase } from "@ren/db/auth-database"
import { Auth } from "@ren/schema/auth"
import { Identifier } from "@ren/schema/identifier"
import { betterAuth } from "better-auth"
import { bearer, organization } from "better-auth/plugins"
import { eq, like, or } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface Input {
  readonly database: AuthDatabase.Interface["db"]
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly google: { readonly clientId: string; readonly clientSecret: string }
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

export const make = (input: Input) =>
  betterAuth({
    appName: "Ren",
    secret: input.secret,
    baseURL: input.baseURL,
    basePath: "/api/auth",
    disabledPaths: ["/organization/leave"],
    trustedOrigins: [...input.trustedOrigins],
    database: drizzleAdapter(input.database, { provider: "pg", schema: AuthDatabase.Schema }),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 90 },
    socialProviders: {
      google: { clientId: input.google.clientId, clientSecret: input.google.clientSecret },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    plugins: [
      bearer(),
      organization({
        invitationExpiresIn: 60 * 60 * 24 * 7,
        organizationHooks: {
          beforeCreateOrganization: async (data) => {
            const root =
              (data.organization.slug || data.organization.name || "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || "organization"
            const rows = await input.database
              .select({ slug: AuthDatabase.Schema.organization.slug })
              .from(AuthDatabase.Schema.organization)
              .where(
                or(
                  eq(AuthDatabase.Schema.organization.slug, root),
                  like(AuthDatabase.Schema.organization.slug, `${root}-%`),
                ),
              )
            const taken = new Set(rows.map((row) => row.slug))
            const candidates = [root, ...Array.from({ length: taken.size }, (_, index) => `${root}-${index + 2}`)]
            return { data: { slug: candidates.find((candidate) => !taken.has(candidate)) ?? root } }
          },
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

export interface Interface {
  readonly handler: (request: Request) => Promise<Response>
  readonly trustedOrigins: ReadonlyArray<string>
  readonly getUser: (headers: Headers) => Effect.Effect<Option.Option<Auth.User>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* AuthDatabase.Service
    const config = yield* Config.all({
      secret: Config.Redacted("BETTER_AUTH_SECRET"),
      baseURL: Config.String("BETTER_AUTH_URL"),
      trustedOrigins: Config.Array(Schema.String, "TRUSTED_ORIGINS").pipe(Config.withDefault([])),
      googleClientId: Config.String("GOOGLE_CLIENT_ID"),
      googleClientSecret: Config.Redacted("GOOGLE_CLIENT_SECRET"),
    })
    const auth = make({
      database: database.db,
      secret: Redacted.value(config.secret),
      baseURL: config.baseURL,
      trustedOrigins: config.trustedOrigins,
      google: { clientId: config.googleClientId, clientSecret: Redacted.value(config.googleClientSecret) },
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
    })
  }),
)
