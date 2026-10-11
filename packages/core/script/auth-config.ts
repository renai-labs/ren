import { AuthDatabase } from "@ren/db/auth-database"
import { drizzle } from "drizzle-orm/bun-sql/postgres"
import { Auth } from "../src/auth.js"

export const auth = Auth.make({
  database: drizzle.mock({ relations: AuthDatabase.Schema.authRelations }),
  secret: "generate-auth-schema",
  baseURL: "http://localhost",
  trustedOrigins: [],
  google: { clientId: "generate-auth-schema", clientSecret: "generate-auth-schema" },
  appURL: "http://localhost",
  sendEmail: () => {},
})
