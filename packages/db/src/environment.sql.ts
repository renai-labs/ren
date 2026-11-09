import type { Auth } from "@ren/schema/auth"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Environment } from "@ren/schema/environment"
import type { Machine } from "@ren/schema/machine"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import { Primitive } from "@ren/schema/primitive"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type { Schema } from "effect"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

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
    // oxlint-disable-next-line ren/no-comments -- The config that built `image`; a machine updates in place from the config of its image (EN22).
    image_config: jsonb().$type<Schema.Json>(),
    build_error: text(),
    // oxlint-disable-next-line ren/no-comments -- Each saved config gets the next number; a build counts only while the template still has the config of its number (EN30).
    config_version: integer().notNull().default(0),
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
    // oxlint-disable-next-line ren/no-comments -- The columns of MachineLifecycle.Row: a remote hand's machine has the same state machine as a brain's (EN1).
    template: text(),
    template_config: jsonb().$type<{
      readonly environmentTemplateId: EnvironmentTemplate.ID
      readonly config: Schema.Json
    }>(),
    egress: boolean().notNull().default(false),
    url: text(),
    generation: integer().notNull().default(1),
    run_epoch: integer().notNull().default(0),
    phase: text().$type<Machine.Phase>().notNull().default("creating"),
    failures: integer().notNull().default(0),
    failure: text(),
    keep_alive_until: timestamp(),
    last_active_at: timestamp(),
    last_progress_at: timestamp(),
    retry_at: timestamp(),
    retries: integer().notNull().default(0),
    unanswered_since: timestamp(),
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
