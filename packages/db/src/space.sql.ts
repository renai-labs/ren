import type { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import { Primitive } from "@ren/schema/primitive"
import type { Brain } from "@ren/schema/brain"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, isNull, sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"

export const spaceMemberUserConstraint = "space_member_space_id_user_id_uidx"

export const spacePendingMemberEmailConstraint = "space_pending_member_space_id_email_uidx"

export const space = pgTable(
  "space",
  {
    id: text().$type<Space.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    brain_scope: text().$type<Brain.Scope>().notNull().default("space"),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
    agent_order: jsonb().$type<ReadonlyArray<Agent.ID>>().notNull().default([]),
  },
  (table) => [
    index("space_organization_id_created_at_id_idx").on(table.organization_id, table.created_at, table.id),
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
