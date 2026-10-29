import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import type { Usage } from "@ren/schema/usage"
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"

// oxlint-disable-next-line ren/no-comments -- One row for each cost, as the producer sent it. Rows are only inserted, never updated or deleted (usage spec §4.3). The claims (root_session to variant) are what the brain sent; usage_attribution holds what Ren checked. No foreign keys: the row outlives the session, brain and space that it names.
export const usage_event = pgTable(
  "usage_event",
  {
    source: text().notNull(),
    id: text().notNull(),
    type: text().$type<Usage.Type>().notNull(),
    time: timestamp().notNull(),
    workload: text().notNull(),
    organization: text().$type<Auth.OrganizationID>().notNull(),
    brain: text().$type<Brain.ID>(),
    space: text().$type<Space.ID>(),
    root_session: text(),
    session: text(),
    turn: text(),
    member: text(),
    agent_name: text(),
    kind: text(),
    requested_model: text().notNull(),
    variant: text(),
    payer: text().$type<Usage.Payer>().notNull(),
    provider: text().notNull(),
    served_model: text().notNull(),
    input_tokens: integer().notNull().default(0),
    output_tokens: integer().notNull().default(0),
    reasoning_tokens: integer().notNull().default(0),
    cache_read_tokens: integer().notNull().default(0),
    cache_write_tokens: integer().notNull().default(0),
    cache_write_1h_tokens: integer().notNull().default(0),
    cost_micro_usd: bigint({ mode: "number" }),
    latency_ms: integer(),
    time_to_first_token_ms: integer(),
    stop_reason: text(),
    error: jsonb().$type<Usage.Failure>(),
    received_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.id] }),
    index("usage_event_organization_time_idx").on(table.organization, table.time),
  ],
)

// oxlint-disable-next-line ren/no-comments -- The events that reconciliation has not checked yet. Ingest adds one row for each new event; reconciliation removes it when it writes the event's usage_attribution row.
export const usage_pending = pgTable(
  "usage_pending",
  {
    source: text().notNull(),
    id: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.id] })],
)

// oxlint-disable-next-line ren/no-comments -- What Ren checked for each event: the claims that agree with the brain's own rows, null where they do not, and the problems it found. One row for each event, only inserted (usage spec §4.3).
export const usage_attribution = pgTable(
  "usage_attribution",
  {
    source: text().notNull(),
    id: text().notNull(),
    space: text().$type<Space.ID>(),
    root_session: text().$type<Session.ID>(),
    session: text().$type<Session.ID>(),
    turn: text(),
    member: text().$type<typeof Auth.MemberID.Type>(),
    agent: text().$type<Agent.ID>(),
    kind: text().$type<Usage.Kind>(),
    problems: text().array().notNull(),
    reconciled_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.id] }),
    index("usage_attribution_session_idx").on(table.session),
  ],
)
