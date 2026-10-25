import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Credential } from "@ren/schema/credential"
import type { Session } from "@ren/schema/session"
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"
import { credential } from "./credential.sql.js"

export const channel_install = pgTable(
  "channel_install",
  {
    id: text().$type<Channel.InstallID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text().$type<Channel.Provider>().notNull(),
    workspace: text().notNull(),
    name: text().notNull(),
    bot_user: text(),
    credential_id: text()
      .$type<Credential.ID>()
      .references(() => credential.id, { onDelete: "set null" }),
    installed_by: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_install_provider_workspace_uidx").on(table.provider, table.workspace),
    uniqueIndex("channel_install_organization_id_provider_uidx").on(table.organization_id, table.provider),
  ],
)

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
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_thread_provider_install_thread_uidx").on(table.provider, table.install, table.thread),
    index("channel_thread_session_id_idx").on(table.session_id),
  ],
)
