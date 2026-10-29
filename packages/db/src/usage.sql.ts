import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Space } from "@ren/schema/space"
import type { Usage } from "@ren/schema/usage"
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"

// oxlint-disable-next-line ren/no-comments -- One row for each cost, as the producer sent it. Rows are only inserted, never updated or deleted (usage spec §4.3). The claims (root_session to variant) are what the brain sent; Ren does not check them yet. No foreign keys: the row outlives the session, brain and space that it names.
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
