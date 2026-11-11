import { Auth } from "@ren/schema/auth"
import { Primitive } from "@ren/schema/primitive"
import type { Brain } from "@ren/schema/brain"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Factory } from "@ren/schema/factory"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, isNull, sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"

export const spaceMemberUserConstraint = "space_member_space_id_user_id_uidx"

export const spacePendingMemberEmailConstraint = "space_pending_member_space_id_email_uidx"

export const privateSpaceOwnerConstraint = "space_organization_id_owner_user_id_uidx"

export const spaceSlugConstraint = "space_organization_id_slug_uidx"

export const space = pgTable(
  "space",
  {
    id: text().$type<Space.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text().$type<Space.Kind>().notNull().default("shared"),
    owner_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    brain_scope: text().$type<Brain.Scope>().notNull().default("space"),
    // oxlint-disable-next-line ren/no-comments -- Null: the deployment's first brain provider.
    brain_provider: text().$type<EnvironmentProvider.ID>(),
    brain_template_id: text().$type<EnvironmentTemplate.ID>(),
    hand_placement: text().$type<Space.Hand["placement"]>().notNull().default("colocated"),
    // oxlint-disable-next-line ren/no-comments -- No foreign key: environment.sql.ts already references space. Templates are archived, never deleted, and archiving one that a space uses is refused (EN24).
    environment_template_id: text().$type<EnvironmentTemplate.ID>(),
    // oxlint-disable-next-line ren/no-comments -- The number of the brain and hand settings. Each change of them takes the next; a brain records the number it applied at its last start or wake.
    compute_revision: integer().notNull().default(0),
    // oxlint-disable-next-line ren/no-comments -- "running" while a shutdown runs. Each shutdown takes the next epoch, the key of its durable run.
    shutdown_state: text().$type<"running">(),
    shutdown_epoch: integer().notNull().default(0),
    // oxlint-disable-next-line ren/no-comments -- The last shutdown's Space.ShutdownReport, with its time as an ISO string.
    shutdown_report: jsonb().$type<{ readonly finishedAt: string; readonly problems: ReadonlyArray<string> }>(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
    factory: jsonb().$type<Factory.Info>().notNull().default(Factory.empty),
  },
  (table) => [
    index("space_organization_id_created_at_id_idx").on(table.organization_id, table.created_at, table.id),
    uniqueIndex(spaceSlugConstraint).on(table.organization_id, table.slug).where(isNull(table.archived_at)),
    uniqueIndex(privateSpaceOwnerConstraint)
      .on(table.organization_id, table.owner_user_id)
      .where(sql`${table.kind} = 'private' and ${table.archived_at} is null`),
    check("space_kind_check", sql`${table.kind} in ('shared', 'private')`),
    index("space_environment_template_id_idx").on(table.environment_template_id),
    index("space_brain_template_id_idx").on(table.brain_template_id),
    check(
      "space_hand_check",
      sql`case ${table.hand_placement} when 'remote' then ${table.environment_template_id} is not null when 'colocated' then ${table.environment_template_id} is null when 'none' then ${table.environment_template_id} is null else false end`,
    ),
    check("space_owner_check", sql`(${table.kind} = 'private') = (${table.owner_user_id} is not null)`),
    check(
      "space_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(Primitive.maximumNameLength))}`,
    ),
  ],
)

export const space_member = pgTable(
  "space_member",
  {
    id: text().$type<Space.MembershipID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    user_id: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(spaceMemberUserConstraint).on(table.space_id, table.user_id).where(isNull(table.archived_at)),
    index("space_member_user_id_idx").on(table.user_id),
  ],
)

export const space_pending_member = pgTable(
  "space_pending_member",
  {
    id: text().$type<Space.AssignmentID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    email: text().notNull(),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(spacePendingMemberEmailConstraint).on(table.space_id, table.email).where(isNull(table.archived_at)),
    index("space_pending_member_email_idx").on(table.email),
  ],
)

export const spaceRelations = defineRelationsPart(
  { organization, user, space, space_member, space_pending_member },
  (r) => ({
    space: {
      organization: r.one.organization({ from: r.space.organization_id, to: r.organization.id }),
      members: r.many.space_member({ from: r.space.id, to: r.space_member.space_id }),
      pendingMembers: r.many.space_pending_member({ from: r.space.id, to: r.space_pending_member.space_id }),
    },
    space_member: {
      space: r.one.space({ from: r.space_member.space_id, to: r.space.id }),
      user: r.one.user({ from: r.space_member.user_id, to: r.user.id }),
    },
    space_pending_member: {
      space: r.one.space({ from: r.space_pending_member.space_id, to: r.space.id }),
    },
  }),
)
