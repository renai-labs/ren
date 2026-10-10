import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ren:ren@localhost:54320/ren",
  },
})
