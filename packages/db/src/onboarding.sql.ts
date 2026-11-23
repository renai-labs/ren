import type { Auth } from "@ren/schema/auth"
import type { Onboarding } from "@ren/schema/onboarding"
import { jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"

export const onboarding = pgTable(
  "onboarding",
  {
    id: text().$type<Onboarding.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "cascade" }),
    steps: jsonb().$type<Readonly<Record<string, string>>>().notNull().default({}),
    dismissed_at: timestamp(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [unique("onboarding_owner_unique").on(table.organization_id, table.user_id).nullsNotDistinct()],
)
