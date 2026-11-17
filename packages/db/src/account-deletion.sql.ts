import type { Auth } from "@ren/schema/auth"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth.sql.js"

export const account_deletion = pgTable("account_deletion", {
  user_id: text()
    .$type<Auth.UserID>()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  requested_at: timestamp().defaultNow().notNull(),
})
