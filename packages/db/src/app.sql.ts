import type { App } from "@ren/schema/app"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const appSlugConstraint = "app_slug_uidx"

export const app = pgTable(
  "app",
  {
    id: text().$type<App.ID>().primaryKey(),
    slug: text().notNull(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .references(() => organization.id),
    owner_space_id: text()
      .$type<Space.ID>()
      .references(() => space.id),
    name: text().notNull(),
    description: text().notNull(),
    icon: text(),
    required_credentials: jsonb().$type<App.Definition["requiredCredentials"]>().notNull(),
    environment: jsonb().$type<App.Environment>(),
    mcps: jsonb().$type<App.Definition["mcps"]>().notNull(),
    skills: jsonb().$type<App.Definition["skills"]>().notNull(),
    revision: integer().notNull().default(1),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(appSlugConstraint).on(table.slug),
    index("app_owner_space_id_idx").on(table.owner_space_id),
    check("app_ownership_check", sql`(${table.organization_id} is null) = (${table.owner_space_id} is null)`),
  ],
)

export const app_dependency = pgTable(
  "app_dependency",
  {
    app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
    dependency_app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
  },
  (table) => [
    primaryKey({ columns: [table.app_id, table.dependency_app_id] }),
    index("app_dependency_dependency_app_id_idx").on(table.dependency_app_id),
  ],
)

export const appProfileSlugConstraint = "app_profile_slug_uidx"

export const app_profile = pgTable(
  "app_profile",
  {
    id: text().$type<AppProfile.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
    slug: text().notNull(),
    name: text().notNull(),
    kind: text().$type<AppProfile.Kind>().notNull(),
    user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "cascade" }),
    all_spaces: boolean().notNull().default(false),
    created_by_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex(appProfileSlugConstraint).on(table.organization_id, table.app_id, table.slug),
    index("app_profile_app_id_idx").on(table.app_id),
    index("app_profile_user_id_idx").on(table.user_id),
    check("app_profile_kind_check", sql`(${table.kind} = 'private') = (${table.user_id} is not null)`),
    check("app_profile_all_spaces_check", sql`not (${table.kind} = 'private' and ${table.all_spaces})`),
  ],
)

export const app_profile_space = pgTable(
  "app_profile_space",
  {
    profile_id: text()
      .$type<AppProfile.ID>()
      .notNull()
      .references(() => app_profile.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.profile_id, table.space_id] }),
    index("app_profile_space_space_id_idx").on(table.space_id),
  ],
)

export const app_profile_link = pgTable(
  "app_profile_link",
  {
    profile_id: text()
      .$type<AppProfile.ID>()
      .notNull()
      .references(() => app_profile.id, { onDelete: "cascade" }),
    dependency_app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
    dependency_profile_id: text()
      .$type<AppProfile.ID>()
      .notNull()
      .references(() => app_profile.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.profile_id, table.dependency_app_id] }),
    index("app_profile_link_dependency_profile_id_idx").on(table.dependency_profile_id),
  ],
)

export const appRelations = defineRelationsPart({ app, app_dependency, organization, space }, (r) => ({
  app: {
    ownerSpace: r.one.space({ from: r.app.owner_space_id, to: r.space.id }),
    organization: r.one.organization({ from: r.app.organization_id, to: r.organization.id }),
  },
  app_dependency: {
    app: r.one.app({ from: r.app_dependency.app_id, to: r.app.id }),
    dependency: r.one.app({ from: r.app_dependency.dependency_app_id, to: r.app.id }),
  },
}))
