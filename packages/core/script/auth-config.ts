import { drizzle } from "drizzle-orm/bun-sql/postgres"
import { Auth } from "../src/auth.js"

export const auth = Auth.make({
  database: drizzle.mock(),
  secret: "generate-auth-schema",
  baseURL: "http://localhost",
  trustedOrigins: [],
})
