import type { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
import { boolean, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { member, organization } from "./auth.sql.js"

// oxlint-disable-next-line ren/no-comments -- Providers §5.1: one row per card the organization changed. No row: the card's defaults. The key itself lives only in the model gateway; Ren keeps its last 4 characters.
export const organization_provider = pgTable(
  "organization_provider",
  {
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    enabled: boolean().notNull(),
    method: text().$type<Models.Method>().notNull(),
    new_models: boolean(),
    key_last4: text(),
    key_tested_at: timestamp(),
    key_saved_by: text()
      .$type<typeof Auth.MemberID.Type>()
      .references(() => member.id, { onDelete: "set null" }),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.organization_id, table.provider_id] })],
)

// oxlint-disable-next-line ren/no-comments -- Providers §5.2: an explicit on or off for one of Ren's models. A model without a row takes the card's "New models on".
export const organization_ren_model = pgTable(
  "organization_ren_model",
  {
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    model_id: text().notNull(),
    enabled: boolean().notNull(),
  },
  (table) => [primaryKey({ columns: [table.organization_id, table.model_id] })],
)

// oxlint-disable-next-line ren/no-comments -- Providers §6.4: each seat's models, as the gateway reports them.
export const organization_seat_models = pgTable(
  "organization_seat_models",
  {
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connection_id: text().notNull(),
    vendor: text().notNull(),
    models: text().array().notNull(),
    plan: text(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.organization_id, table.connection_id] })],
)
