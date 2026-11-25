export * as Postgres from "./postgres.js"

import { PgClient } from "@effect/sql-pg"
import { Config } from "effect"

// oxlint-disable-next-line ren/no-comments -- The channel of brain pushes: the triggers in the migrations and Ren core send `org:<id>`, `space:<id>` or `all` on it.
export const brainsChannel = "ren_brains"

export const layer = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
})
