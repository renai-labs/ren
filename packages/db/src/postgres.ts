export * as Postgres from "./postgres.js"

import { PgClient } from "@effect/sql-pg"
import { Config } from "effect"

export const layer = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
})
