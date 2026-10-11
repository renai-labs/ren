export * as Auth from "./auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { AuthDatabase } from "@ren/db/auth-database"
import { Auth } from "@ren/schema/auth"
import { Identifier } from "@ren/schema/identifier"
import { betterAuth } from "better-auth"
import { bearer, organization } from "better-auth/plugins"
import { eq, like, or } from "drizzle-orm"
import freeEmailDomains from "free-email-domains"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { getDomainWithoutSuffix } from "tldts"

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
      organization({
        invitationExpiresIn: 60 * 60 * 24 * 7,
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
  readonly getActiveOrganization: (headers: Headers) => Effect.Effect<Option.Option<Auth.OrganizationID>>
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
      getActiveOrganization: Effect.fn("Auth.getActiveOrganization")(function* (headers: Headers) {
        const session = yield* Effect.promise(() => auth.api.getSession({ headers }))
        if (!session) return Option.none()
        const memberships = yield* Effect.promise(() =>
          database.db.query.member.findMany({
            columns: { organizationId: true },
            where: { userId: session.user.id },
            orderBy: { createdAt: "asc", id: "asc" },
          }),
        )
        const membership =
          memberships.find((row) => row.organizationId === session.session.activeOrganizationId) ?? memberships[0]
        if (!membership) return Option.none()
        return Option.some(
          yield* Schema.decodeEffect(Auth.OrganizationID)(membership.organizationId).pipe(Effect.orDie),
        )
      }),
    })
  }),
)
