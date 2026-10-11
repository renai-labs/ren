export * as Auth from "./auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { AuthDatabase } from "@ren/db/auth-database"
import { Auth } from "@ren/schema/auth"
import { Identifier } from "@ren/schema/identifier"
import { betterAuth } from "better-auth"
import { bearer } from "better-auth/plugins"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface Input {
  readonly database: Parameters<typeof drizzleAdapter>[0]
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
}

const ids: Record<string, () => string> = {
  user: Auth.UserID.create,
  session: Auth.SessionID.create,
  account: Auth.AccountID.create,
  verification: Auth.VerificationID.create,
}

export const make = (input: Input) =>
  betterAuth({
    appName: "Ren",
    secret: input.secret,
    baseURL: input.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [...input.trustedOrigins],
    database: drizzleAdapter(input.database, { provider: "pg", schema: AuthDatabase.Schema }),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 90 },
    plugins: [bearer()],
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
    })
    const auth = make({
      database: database.db,
      secret: Redacted.value(config.secret),
      baseURL: config.baseURL,
      trustedOrigins: config.trustedOrigins,
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
