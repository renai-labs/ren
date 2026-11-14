import type { Auth } from "@ren/schema/auth"
import type { OrganizationInviteLink } from "@ren/schema/organization-invite-link"
import type { Space } from "@ren/schema/space"
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"

export const organization_invite_link = pgTable(
  "organization_invite_link",
  {
    id: text().$type<OrganizationInviteLink.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    created_by: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    space_ids: text().$type<Space.ID>().array().notNull(),
    uses: integer().notNull().default(0),
    expires_at: timestamp().notNull(),
    revoked_at: timestamp(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [index("organization_invite_link_organization_id_idx").on(table.organization_id)],
)
