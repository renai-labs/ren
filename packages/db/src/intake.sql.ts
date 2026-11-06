import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"

export const intake_thread = pgTable(
  "intake_thread",
  {
    id: text().$type<Channel.ThreadID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    origin: text().$type<Session.Origin>().notNull(),
    scope: text().notNull(),
    thread: text().notNull(),
    session_id: text().$type<Session.ID>().notNull(),
    url: text(),
    place_name: text(),
    last_message: text(),
    last_message_at: timestamp(),
    last_reply_at: timestamp(),
    data: jsonb().$type<typeof Channel.ThreadData.Encoded>().notNull().default({}),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("intake_thread_origin_scope_thread_uidx").on(table.origin, table.scope, table.thread),
    index("intake_thread_session_id_idx").on(table.session_id),
  ],
)
