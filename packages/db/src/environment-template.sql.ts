import type { Auth } from "@ren/schema/auth"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import { Primitive } from "@ren/schema/primitive"
import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type { Schema } from "effect"
import { organization } from "./auth.sql.js"

export const environment_template = pgTable(
  "environment_template",
  {
    id: text().$type<EnvironmentTemplate.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    provider: text().$type<EnvironmentProvider.ID>().notNull(),
    config: jsonb().$type<Schema.Json>().notNull(),
    sessions_per_environment: integer().notNull(),
    networking: jsonb().$type<EnvironmentTemplate.Networking>().notNull().default({ type: "unrestricted" }),
    build_status: text().$type<EnvironmentTemplate.BuildStatus>().notNull().default("ready"),
    image: text(),
    build_error: text(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("environment_template_organization_id_created_at_id_idx").on(
      table.organization_id,
      table.created_at,
      table.id,
    ),
    check(
      "environment_template_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(Primitive.maximumNameLength))}`,
    ),
    check(
      "environment_template_build_status_check",
      sql`${table.build_status} in ('queued', 'building', 'ready', 'failed')`,
    ),
    check(
      "environment_template_sessions_per_environment_check",
      sql`${table.sessions_per_environment} between 1 and ${sql.raw(String(EnvironmentTemplate.maximumSessionsPerEnvironment))}`,
    ),
  ],
)
