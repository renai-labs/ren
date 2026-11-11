import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Bundle } from "@ren/schema/bundle"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Machine } from "@ren/schema/machine"
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
    // oxlint-disable-next-line ren/no-comments -- The image the machine runs: the provider's system image or a template's.
    image: text(),
    // oxlint-disable-next-line ren/no-comments -- The template and config that built the image of a co-located hand's machine; null for the provider's own image.
    image_template: jsonb().$type<{
      readonly environmentTemplateId: EnvironmentTemplate.ID
      readonly config: Schema.Json
      readonly system: string | null
    }>(),
    // oxlint-disable-next-line ren/no-comments -- The space's hand when the machine was created. A brain made for a remote hand runs OpenCode's saved tool output, files and git on the hand (EN13); null on a machine made before this column, which runs them on its own disk.
    hand_placement: text().$type<Space.Hand["placement"]>(),
    // oxlint-disable-next-line ren/no-comments -- The hand the brain's chats use now, and the space's compute_revision it came from. Both change only at the brain's start or wake; null on a brain that has not applied one yet.
    hand: jsonb().$type<Space.AppliedHand>(),
    compute_revision: integer().notNull().default(0),
    // oxlint-disable-next-line ren/no-comments -- The bundle versions the machine runs; null on a machine whose image holds Ren's code (EN26).
    bundles: jsonb().$type<Readonly<Record<Bundle.Kind, string>>>(),
    // oxlint-disable-next-line ren/no-comments -- Set at create and read by every later step: the sandbox sends its traffic through the egress, so the brain holds placeholders, never real keys or its host token.
    egress: boolean().notNull().default(false),
    url: text(),
    generation: integer().notNull().default(1),
    run_epoch: integer().notNull().default(0),
    phase: text().$type<Machine.Phase>().notNull().default("creating"),
    failures: integer().notNull().default(0),
    failure: text(),
    keep_alive_until: timestamp(),
    last_active_at: timestamp(),
    // oxlint-disable-next-line ren/no-comments -- EN19: a failed brain starts again at its first access after retry_at; retries counts these starts since the last ready.
    retry_at: timestamp(),
    retries: integer().notNull().default(0),
    // oxlint-disable-next-line ren/no-comments -- EN17: the first check that found the brain silent while its machine runs.
    unanswered_since: timestamp(),
    network_hosts: jsonb().$type<ReadonlyArray<string>>(),
    last_progress_at: timestamp(),
    last_pulled_at: timestamp(),
    lost_at: timestamp(),
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
