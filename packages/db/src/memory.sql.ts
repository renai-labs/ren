import type { Auth } from "@ren/schema/auth"
import type { Memory } from "@ren/schema/memory"
import type { Space } from "@ren/schema/space"
import { sql } from "drizzle-orm"
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const memory = pgTable(
  "memory",
  {
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .unique()
      .references(() => space.id, { onDelete: "cascade" }),
    files: jsonb().$type<Memory.Files>().notNull().default({}),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [check("memory_one_owner_check", sql`num_nonnulls(${table.organization_id}, ${table.space_id}) = 1`)],
)
