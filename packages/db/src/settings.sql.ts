import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Settings } from "@ren/schema/settings"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, type SQL, sql } from "drizzle-orm"
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const renOwner = "ren"

export const settings = pgTable(
  "settings",
  {
    owner_id: text()
      .primaryKey()
      .generatedAlwaysAs(
        (): SQL =>
          sql`coalesce(${settings.agent_id}, ${settings.space_id}, ${settings.organization_id}, ${sql.raw(`'${renOwner}'`)})`,
      ),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "cascade" }),
    settings: jsonb().$type<typeof Settings.Info.Encoded>().notNull(),
    hash: text()
      .notNull()
      .generatedAlwaysAs((): SQL => sql`md5(${settings.settings}::text)`),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    check(
      "settings_one_owner_check",
      sql`num_nonnulls(${table.organization_id}, ${table.space_id}, ${table.agent_id}) <= 1`,
    ),
  ],
)

export const settingsRelations = defineRelationsPart({ organization, space, agent, settings }, (r) => ({
  settings: {
    organization: r.one.organization({ from: r.settings.organization_id, to: r.organization.id }),
    space: r.one.space({ from: r.settings.space_id, to: r.space.id }),
    agent: r.one.agent({ from: r.settings.agent_id, to: r.agent.id }),
  },
}))
