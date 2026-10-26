import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Agent } from "@ren/schema/agent"
import type { ChannelInstall } from "@ren/schema/channel-install"
import type { ChannelMapping } from "@ren/schema/channel-mapping"
import type { Credential } from "@ren/schema/credential"
import type { Envelope } from "@ren/schema/envelope"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { organization, user } from "./auth.sql.js"
import { credential } from "./credential.sql.js"
import { space } from "./space.sql.js"

export const channel_install = pgTable(
  "channel_install",
  {
    id: text().$type<ChannelInstall.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text().$type<Channel.Provider>().notNull(),
    workspace: text().notNull(),
    name: text().notNull(),
    bot_user: text(),
    secret: jsonb().$type<Envelope.Sealed>(),
    credential_id: text()
      .$type<Credential.ID>()
      .references(() => credential.id, { onDelete: "set null" }),
    installed_by: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    default_space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_install_provider_workspace_uidx").on(table.provider, table.workspace),
    uniqueIndex("channel_install_organization_id_provider_uidx").on(table.organization_id, table.provider),
  ],
)

export const channel_mapping = pgTable(
  "channel_mapping",
  {
    id: text().$type<ChannelMapping.ID>().primaryKey(),
    install_id: text()
      .$type<ChannelInstall.ID>()
      .notNull()
      .references(() => channel_install.id, { onDelete: "cascade" }),
    place: text().notNull(),
    place_name: text().notNull(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    fallback: boolean().notNull().default(true),
    fallback_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    triggers: jsonb().$type<ReadonlyArray<Channel.TriggerSetting>>().notNull().default([]),
    created_by: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_mapping_install_id_place_uidx").on(table.install_id, table.place),
    index("channel_mapping_space_id_idx").on(table.space_id),
  ],
)

export const channel_install_state = pgTable("channel_install_state", {
  state: text().primaryKey(),
  organization_id: text()
    .$type<Auth.OrganizationID>()
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  provider: text().$type<Channel.Provider>().notNull(),
  initiator_user_id: text()
    .$type<Auth.UserID>()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  created_at: timestamp().defaultNow().notNull(),
  expires_at: timestamp().notNull(),
  consumed_at: timestamp(),
})

export const channel_thread = pgTable(
  "channel_thread",
  {
    id: text().$type<Channel.ThreadID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text().$type<Channel.Provider>().notNull(),
    install: text().notNull(),
    thread: text().notNull(),
    session_id: text().$type<Session.ID>().notNull(),
    url: text(),
    place_name: text(),
    last_message: text(),
    last_message_at: timestamp(),
    last_reply_at: timestamp(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_thread_provider_install_thread_uidx").on(table.provider, table.install, table.thread),
    index("channel_thread_session_id_idx").on(table.session_id),
  ],
)
