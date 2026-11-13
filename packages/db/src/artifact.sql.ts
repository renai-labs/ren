import type { Artifact } from "@ren/schema/artifact"
import type { Auth } from "@ren/schema/auth"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import type { Schema } from "effect"
import { sql } from "drizzle-orm"
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"
import { agent_session } from "./session.sql.js"
import { space } from "./space.sql.js"

export const artifactNameConstraint = "artifact_name_idx"

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
    name: text().$type<Artifact.Name>(),
    provider: text().$type<Artifact.ProviderID>().notNull(),
    code_archive: text(),
    config: jsonb().$type<Artifact.Config>(),
    remote: jsonb().$type<Schema.Json>(),
    remote_version: integer().default(0).notNull(),
    url: text(),
    pending_deployment_id: text().$type<Artifact.DeploymentID>(),
    published_deployment_id: text().$type<Artifact.DeploymentID>(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("artifact_space_id_idx").on(table.space_id),
    uniqueIndex("artifact_label_idx").on(sql`lower(${table.id})`),
    uniqueIndex(artifactNameConstraint).on(table.name),
  ],
)

// oxlint-disable-next-line ren/no-comments -- Each change of who owns a name moves its epoch on. synced_epoch is the last epoch whose owner the provider has; a name with synced_epoch below epoch is not copied yet.
export const artifact_name_sync = pgTable("artifact_name_sync", {
  name: text().$type<Artifact.Name>().primaryKey(),
  epoch: integer().notNull(),
  synced_epoch: integer().default(0).notNull(),
})

export const artifact_deployment = pgTable(
  "artifact_deployment",
  {
    id: text().$type<Artifact.DeploymentID>().primaryKey(),
    artifact_id: text()
      .$type<Artifact.ID>()
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    kind: text().$type<"deploy" | "stop">().notNull(),
    status: text().$type<Artifact.Status>().notNull(),
    base_deployment_id: text().$type<Artifact.DeploymentID>(),
    session_id: text()
      .$type<Session.ID>()
      .references(() => agent_session.id, { onDelete: "set null" }),
    upload_id: text().$type<Artifact.UploadID>(),
    title: text(),
    entry: text(),
    config: jsonb().$type<Artifact.Config>(),
    code_archive: text(),
    url: text(),
    error: text(),
    created_at: timestamp().defaultNow().notNull(),
    finished_at: timestamp(),
  },
  (table) => [index("artifact_deployment_artifact_id_idx").on(table.artifact_id)],
)
