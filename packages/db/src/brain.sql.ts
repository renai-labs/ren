import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { sql } from "drizzle-orm"
import type { Schema } from "effect"
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const brain = pgTable(
  "brain",
  {
    id: text().$type<Brain.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    scope: text().$type<Brain.Scope>().notNull(),
    key_ids: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    provider: text(),
    binding: jsonb().$type<Schema.Json>(),
    template: text(),
    // oxlint-disable-next-line ren/no-comments -- Set at create and read by every later step: the sandbox sends its traffic through the egress, so the brain holds placeholders, never real keys or its host token.
    egress: boolean().notNull().default(false),
    url: text(),
    generation: integer().notNull().default(1),
    run_epoch: integer().notNull().default(0),
    phase: text().$type<Brain.Phase>().notNull().default("creating"),
    failures: integer().notNull().default(0),
    failure: text(),
    keep_alive_until: timestamp(),
    last_active_at: timestamp(),
    last_progress_at: timestamp(),
    progress: jsonb().$type<Readonly<Record<string, string>>>(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("brain_space_id_uidx")
      .on(table.space_id)
      .where(sql`${table.scope} = 'space'`),
    index("brain_organization_id_idx").on(table.organization_id),
  ],
)
