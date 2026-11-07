import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { IntakeThread } from "@ren/schema/intake-thread"
import type { Session } from "@ren/schema/session"
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"

export const intake_thread = pgTable(
  "intake_thread",
  {
    id: text().$type<IntakeThread.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    origin: text().$type<Session.Origin>().notNull(),
    origin_id: text().notNull(),
    thread_key: text().notNull(),
    current_session_id: text().$type<Session.ID>().notNull(),
    channel_state: jsonb().$type<typeof Channel.ThreadState.Encoded>().notNull().default({}),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("intake_thread_origin_origin_id_thread_key_uidx").on(table.origin, table.origin_id, table.thread_key),
    index("intake_thread_current_session_id_idx").on(table.current_session_id),
  ],
)
