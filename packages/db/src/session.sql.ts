import type { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { defineRelationsPart } from "drizzle-orm"
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { organization, user } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const agent_session = pgTable(
  "agent_session",
  {
    id: text().$type<Session.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    created_by: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parent_id: text()
      .$type<Session.ID>()
      .references((): AnyPgColumn => agent_session.id, { onDelete: "cascade" }),
    root_id: text()
      .$type<Session.ID>()
      .notNull()
      .references((): AnyPgColumn => agent_session.id, { onDelete: "cascade" }),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    harness: text().$type<Session.Harness>().notNull(),
    start_input: jsonb().$type<Omit<typeof Session.StartInput.Encoded, "initialMessage">>(),
    sync_seq: bigint({ mode: "number" }),
    sync_upload: integer().notNull().default(0),
    sync_upload_open: boolean().notNull().default(false),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("agent_session_root_id_idx").on(table.root_id),
    index("agent_session_agent_id_idx").on(table.agent_id),
  ],
)

export const opencode_session = pgTable("opencode_session", {
  session_id: text()
    .$type<Session.ID>()
    .primaryKey()
    .references(() => agent_session.id, { onDelete: "cascade" }),
  project_id: text().notNull(),
  workspace_id: text(),
  slug: text().notNull(),
  directory: text().notNull(),
  path: text(),
  title: text(),
  version: text().notNull(),
  summary_additions: bigint({ mode: "number" }),
  summary_deletions: bigint({ mode: "number" }),
  summary_files: bigint({ mode: "number" }),
  metadata: text(),
  cost: doublePrecision().notNull(),
  tokens_input: bigint({ mode: "number" }).notNull(),
  tokens_output: bigint({ mode: "number" }).notNull(),
  tokens_reasoning: bigint({ mode: "number" }).notNull(),
  tokens_cache_read: bigint({ mode: "number" }).notNull(),
  tokens_cache_write: bigint({ mode: "number" }).notNull(),
  permission: text(),
  agent: text(),
  model: text(),
  time_created: bigint({ mode: "number" }).notNull(),
  time_updated: bigint({ mode: "number" }).notNull(),
  time_idle: bigint({ mode: "number" }),
  time_viewed: bigint({ mode: "number" }),
  idle_outcome: text(),
  time_archived: bigint({ mode: "number" }),
  time_suspended: bigint({ mode: "number" }),
})

export const opencode_message = pgTable(
  "opencode_message",
  {
    id: text().notNull(),
    session_id: text()
      .$type<Session.ID>()
      .notNull()
      .references(() => agent_session.id, { onDelete: "cascade" }),
    type: text().notNull(),
    seq: bigint({ mode: "number" }).notNull(),
    data: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.id] }),
    index("opencode_message_session_id_seq_idx").on(table.session_id, table.seq),
  ],
)

export const sessionRelations = defineRelationsPart(
  { organization, user, space, agent, agent_session, opencode_session, opencode_message },
  (r) => ({
    agent_session: {
      organization: r.one.organization({ from: r.agent_session.organization_id, to: r.organization.id }),
      space: r.one.space({ from: r.agent_session.space_id, to: r.space.id }),
      agent: r.one.agent({ from: r.agent_session.agent_id, to: r.agent.id }),
      creator: r.one.user({ from: r.agent_session.created_by, to: r.user.id }),
      parent: r.one.agent_session({ from: r.agent_session.parent_id, to: r.agent_session.id, alias: "parent" }),
      children: r.many.agent_session({ from: r.agent_session.id, to: r.agent_session.parent_id, alias: "parent" }),
      root: r.one.agent_session({ from: r.agent_session.root_id, to: r.agent_session.id, alias: "root" }),
      opencode: r.one.opencode_session({ from: r.agent_session.id, to: r.opencode_session.session_id }),
      opencodeMessages: r.many.opencode_message({ from: r.agent_session.id, to: r.opencode_message.session_id }),
    },
    opencode_session: {
      session: r.one.agent_session({ from: r.opencode_session.session_id, to: r.agent_session.id }),
    },
    opencode_message: {
      session: r.one.agent_session({ from: r.opencode_message.session_id, to: r.agent_session.id }),
    },
  }),
)
