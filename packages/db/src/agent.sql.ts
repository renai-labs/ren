import { Agent } from "@ren/schema/agent"
import type { AgentMembership } from "@ren/schema/agent-membership"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { defineRelationsPart, isNull, sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const agentNameConstraint = "agent_organization_id_name_uidx"

export const globalAgentNameConstraint = "agent_global_name_uidx"

export const agentMembershipConstraint = "agent_membership_space_id_agent_id_uidx"

export const agent = pgTable(
  "agent",
  {
    id: text().$type<Agent.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .references(() => organization.id, { onDelete: "cascade" }),
    owner_space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    is_subagent: boolean().notNull(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(agentNameConstraint).on(table.organization_id, table.name).where(isNull(table.archived_at)),
    uniqueIndex(globalAgentNameConstraint)
      .on(table.name)
      .where(sql`${table.organization_id} is null and ${table.archived_at} is null`),
    index("agent_owner_space_id_idx").on(table.owner_space_id),
    check("agent_global_check", sql`(${table.organization_id} is null) = (${table.owner_space_id} is null)`),
    check(
      "agent_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(Agent.maximumNameLength))}`,
    ),
  ],
)

export const agent_membership = pgTable(
  "agent_membership",
  {
    id: text().$type<AgentMembership.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    agent_id: text()
      .$type<Agent.ID>()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex(agentMembershipConstraint).on(table.space_id, table.agent_id),
    index("agent_membership_agent_id_idx").on(table.agent_id),
  ],
)

export const agentRelations = defineRelationsPart({ organization, space, agent, agent_membership }, (r) => ({
  agent: {
    organization: r.one.organization({ from: r.agent.organization_id, to: r.organization.id }),
    ownerSpace: r.one.space({ from: r.agent.owner_space_id, to: r.space.id }),
    memberships: r.many.agent_membership({ from: r.agent.id, to: r.agent_membership.agent_id }),
  },
  agent_membership: {
    space: r.one.space({ from: r.agent_membership.space_id, to: r.space.id }),
    agent: r.one.agent({ from: r.agent_membership.agent_id, to: r.agent.id }),
  },
}))
