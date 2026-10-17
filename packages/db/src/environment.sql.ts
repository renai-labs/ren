import type { Auth } from "@ren/schema/auth"
import type { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import { defineRelationsPart } from "drizzle-orm"
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"

export const session_environment = pgTable(
  "session_environment",
  {
    session_id: text().$type<Session.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    environment_id: text().$type<Environment.ID>().notNull(),
    sandbox_id: text(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [index("session_environment_environment_id_sandbox_id_idx").on(table.environment_id, table.sandbox_id)],
)

export const environmentRelations = defineRelationsPart({ organization, session_environment }, (r) => ({
  session_environment: {
    organization: r.one.organization({ from: r.session_environment.organization_id, to: r.organization.id }),
  },
}))
