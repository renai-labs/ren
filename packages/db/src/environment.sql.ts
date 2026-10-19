import type { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/schema/environment"
import type { Hand } from "@ren/schema/hand"
import type { HandProvider } from "@ren/schema/hand-provider"
import { Primitive } from "@ren/schema/primitive"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import type { SpaceEnvironment } from "@ren/schema/space-environment"
import { defineRelationsPart, isNull, sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import type { Schema } from "effect"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const spaceEnvironmentConstraint = "space_environment_space_id_environment_id_uidx"

export const environment = pgTable(
  "environment",
  {
    id: text().$type<Environment.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    provider: text().$type<HandProvider.ID>().notNull(),
    config: jsonb().$type<Schema.Json>().notNull(),
    sessions_per_hand: integer().notNull(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("environment_organization_id_created_at_id_idx").on(table.organization_id, table.created_at, table.id),
    check(
      "environment_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(Primitive.maximumNameLength))}`,
    ),
    check(
      "environment_sessions_per_hand_check",
      sql`${table.sessions_per_hand} between 1 and ${sql.raw(String(Environment.maximumSessionsPerHand))}`,
    ),
  ],
)

export const space_environment = pgTable(
  "space_environment",
  {
    id: text().$type<SpaceEnvironment.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    environment_id: text()
      .$type<Environment.ID>()
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(spaceEnvironmentConstraint).on(table.space_id, table.environment_id).where(isNull(table.archived_at)),
    index("space_environment_environment_id_idx").on(table.environment_id),
  ],
)

export const hand = pgTable(
  "hand",
  {
    id: text().$type<Hand.ID>().primaryKey(),
    environment_id: text()
      .$type<Environment.ID>()
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    binding: jsonb().$type<Schema.Json>(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [index("hand_environment_id_created_at_idx").on(table.environment_id, table.created_at)],
)

export const session_environment = pgTable(
  "session_environment",
  {
    session_id: text().$type<Session.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    environment_id: text()
      .$type<Environment.ID>()
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    hand_id: text()
      .$type<Hand.ID>()
      .references(() => hand.id, { onDelete: "set null" }),
    generation: integer().default(1).notNull(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [index("session_environment_hand_id_idx").on(table.hand_id)],
)

export const environmentRelations = defineRelationsPart(
  { organization, space, environment, space_environment, hand, session_environment },
  (r) => ({
    environment: {
      organization: r.one.organization({ from: r.environment.organization_id, to: r.organization.id }),
      spaces: r.many.space_environment({ from: r.environment.id, to: r.space_environment.environment_id }),
      hands: r.many.hand({ from: r.environment.id, to: r.hand.environment_id }),
    },
    space_environment: {
      space: r.one.space({ from: r.space_environment.space_id, to: r.space.id }),
      environment: r.one.environment({ from: r.space_environment.environment_id, to: r.environment.id }),
    },
    hand: {
      environment: r.one.environment({ from: r.hand.environment_id, to: r.environment.id }),
    },
    session_environment: {
      space: r.one.space({ from: r.session_environment.space_id, to: r.space.id }),
      environment: r.one.environment({ from: r.session_environment.environment_id, to: r.environment.id }),
      hand: r.one.hand({ from: r.session_environment.hand_id, to: r.hand.id }),
    },
  }),
)
