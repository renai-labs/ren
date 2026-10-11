export * as Auth from "./auth.js"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { Auth } from "@ren/schema/auth"
import { Identifier } from "@ren/schema/identifier"
import { betterAuth } from "better-auth"

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
    database: drizzleAdapter(input.database, { provider: "pg" }),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 90 },
    advanced: {
      database: {
        generateId: (options) => (Object.hasOwn(ids, options.model) ? ids[options.model]() : Identifier.ulid()),
      },
    },
  })
