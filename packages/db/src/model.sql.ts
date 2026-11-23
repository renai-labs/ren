import type { Auth } from "@ren/schema/auth"
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"

// oxlint-disable-next-line ren/no-comments -- Providers P9: the last good copy of models.dev, kept to the providers Ren offers. One row per source.
export const model_catalog = pgTable("model_catalog", {
  source: text().primaryKey(),
  etag: text(),
  revision: text().notNull(),
  data: jsonb().notNull(),
  fetched_at: timestamp().notNull(),
})

// oxlint-disable-next-line ren/no-comments -- Providers P26: the hash of each organization's model list. A changed hash notifies the organization's brains (trigger in the migration).
export const organization_model_list = pgTable("organization_model_list", {
  organization_id: text()
    .$type<Auth.OrganizationID>()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  hash: text().notNull(),
  updated_at: timestamp().defaultNow().notNull(),
})
