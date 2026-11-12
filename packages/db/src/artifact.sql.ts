import type { Artifact } from "@ren/schema/artifact"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import type { Schema } from "effect"
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const artifact = pgTable(
  "artifact",
  {
    id: text().$type<Artifact.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    title: text().notNull(),
    provider: text().$type<Artifact.ProviderID>().notNull(),
    code_archive: text(),
    config: jsonb().$type<Artifact.Config>().notNull(),
    binding: jsonb().$type<Schema.Json>(),
    url: text(),
    active_deployment_id: text().$type<Artifact.DeploymentID>(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [index("artifact_space_id_idx").on(table.space_id)],
)
