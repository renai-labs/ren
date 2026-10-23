import type { App } from "@ren/schema/app"
import type { AppRelease } from "@ren/schema/app-release"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"
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
    latest_release_id: text().$type<AppRelease.ID>().notNull(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(appSlugConstraint).on(table.slug),
    index("app_owner_space_id_idx").on(table.owner_space_id),
    check("app_ownership_check", sql`(${table.organization_id} is null) = (${table.owner_space_id} is null)`),
    foreignKey({
      name: "app_latest_release_fk",
      columns: [table.id, table.latest_release_id],
      foreignColumns: [app_release.app_id, app_release.id],
    }),
  ],
)

export const app_release = pgTable(
  "app_release",
  {
    id: text().$type<AppRelease.ID>().primaryKey(),
    app_id: text()
      .$type<App.ID>()
      .notNull()
      .references((): AnyPgColumn => app.id),
    version: text().notNull(),
    required_credentials: jsonb().$type<AppRelease.Configuration["requiredCredentials"]>().notNull(),
    environment: jsonb().$type<AppRelease.Environment>(),
    mcps: jsonb().$type<AppRelease.Configuration["mcps"]>().notNull(),
    skills: jsonb().$type<AppRelease.Configuration["skills"]>().notNull(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    unique("app_release_app_id_id_unique").on(table.app_id, table.id),
    unique("app_release_app_id_version_unique").on(table.app_id, table.version),
  ],
)

export const app_release_dependency = pgTable(
  "app_release_dependency",
  {
    app_release_id: text()
      .$type<AppRelease.ID>()
      .notNull()
      .references(() => app_release.id),
    dependency_app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
  },
  (table) => [
    primaryKey({ columns: [table.app_release_id, table.dependency_app_id] }),
    index("app_release_dependency_app_idx").on(table.dependency_app_id),
  ],
)

export const appRelations = defineRelationsPart(
  { app, app_release, app_release_dependency, organization, space },
  (r) => ({
    app: {
      ownerSpace: r.one.space({ from: r.app.owner_space_id, to: r.space.id }),
      organization: r.one.organization({ from: r.app.organization_id, to: r.organization.id }),
      releases: r.many.app_release({ from: r.app.id, to: r.app_release.app_id }),
    },
    app_release: {
      app: r.one.app({ from: r.app_release.app_id, to: r.app.id }),
      dependencies: r.many.app_release_dependency({
        from: r.app_release.id,
        to: r.app_release_dependency.app_release_id,
      }),
    },
    app_release_dependency: {
      release: r.one.app_release({ from: r.app_release_dependency.app_release_id, to: r.app_release.id }),
      dependency: r.one.app({ from: r.app_release_dependency.dependency_app_id, to: r.app.id }),
    },
  }),
)
