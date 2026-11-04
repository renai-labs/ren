import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type { Schema } from "effect"
import { organization } from "./auth.sql.js"
import { environment_template } from "./environment-template.sql.js"
import { space } from "./space.sql.js"

export const environment = pgTable(
  "environment",
  {
    id: text().$type<Environment.ID>().primaryKey(),
    environment_template_id: text()
      .$type<EnvironmentTemplate.ID>()
      .notNull()
      .references(() => environment_template.id, { onDelete: "cascade" }),
    // oxlint-disable-next-line ren/no-comments -- private-spaces PS8: one space per environment; null on older ones.
    space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    binding: jsonb().$type<Schema.Json>(),
    image: text(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("environment_environment_template_id_created_at_idx").on(table.environment_template_id, table.created_at),
    index("environment_space_id_idx").on(table.space_id),
  ],
)

export const session_environment = pgTable(
  "session_environment",
  {
    session_id: text().$type<Session.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    environment_template_id: text()
      .$type<EnvironmentTemplate.ID>()
      .notNull()
      .references(() => environment_template.id, { onDelete: "cascade" }),
    environment_id: text()
      .$type<Environment.ID>()
      .references(() => environment.id, { onDelete: "set null" }),
    generation: integer().default(1).notNull(),
    idle_at: timestamp(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("session_environment_environment_id_idx").on(table.environment_id),
    check("session_environment_generation_check", sql`${table.generation} >= 1`),
  ],
)

export const environmentTemplateRelations = defineRelationsPart(
  { organization, space, environment_template, environment, session_environment },
  (r) => ({
    environment_template: {
      organization: r.one.organization({ from: r.environment_template.organization_id, to: r.organization.id }),
      environments: r.many.environment({ from: r.environment_template.id, to: r.environment.environment_template_id }),
    },
    environment: {
      environment_template: r.one.environment_template({
        from: r.environment.environment_template_id,
        to: r.environment_template.id,
      }),
    },
    session_environment: {
      space: r.one.space({ from: r.session_environment.space_id, to: r.space.id }),
      environment_template: r.one.environment_template({
        from: r.session_environment.environment_template_id,
        to: r.environment_template.id,
      }),
      environment: r.one.environment({ from: r.session_environment.environment_id, to: r.environment.id }),
    },
  }),
)
