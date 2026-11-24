import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { View } from "@ren/schema/view"
import { sql } from "drizzle-orm"
import { boolean, check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const view = pgTable(
  "view",
  {
    id: text().$type<View.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    owner_id: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    type: text().$type<View.Type>().notNull(),
    name: text().notNull(),
    shared: boolean().notNull().default(false),
    filters: jsonb().$type<View.Filters>().notNull(),
    display: jsonb().$type<View.Display>(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("view_organization_id_space_id_idx")
      .on(table.organization_id, table.space_id)
      .where(sql`${table.archived_at} is null`),
    check(
      "view_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(View.maximumNameLength))}`,
    ),
  ],
)
