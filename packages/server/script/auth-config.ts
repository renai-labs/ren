import { Database } from "@ren/db/database"
import { drizzle } from "drizzle-orm/bun-sql/postgres"
import { Option } from "effect"
import { BetterAuth } from "../src/better-auth.js"

export const auth = BetterAuth.make({
  database: drizzle.mock({ relations: Database.Schema.authRelations }),
  secret: "generate-auth-schema",
  baseURL: "http://localhost",
  trustedOrigins: [],
  google: { clientId: "generate-auth-schema", clientSecret: "generate-auth-schema" },
  appURL: "http://localhost",
  mcpResource: "http://localhost/mcp",
  fetchClientMetadataResource: () => Promise.reject(new Error("generate-auth-schema does not fetch")),
  requireEmailVerification: true,
  sendEmail: () => {},
  logFailure: () => Promise.resolve(),
  signupGuard: {
    checkEmailSignUp: () => Promise.resolve(Option.none()),
    checkAccountCreation: () => Promise.resolve(Option.none()),
    hasVerifiedAlias: () => Promise.resolve(false),
  },
  provisioning: {
    createInitialMemberships: () => Promise.resolve(),
    activatePendingMemberships: () => Promise.resolve(),
    archiveMemberships: () => Promise.resolve(),
    forgetInferenceMember: () => Promise.resolve(),
  },
})

auth.$context.catch(() => undefined)
