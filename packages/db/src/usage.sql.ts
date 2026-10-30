import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Space } from "@ren/schema/space"
import type { Usage } from "@ren/schema/usage"
import { bigint, bigserial, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const usage_event = pgTable(
  "usage_event",
  {
    source: text().notNull(),
    id: text().notNull(),
    type: text().$type<Usage.Event["type"]>().notNull(),
    time: timestamp().notNull(),
    workload: text().notNull(),
    organization: text().$type<Auth.OrganizationID>().notNull(),
    brain: text().$type<Brain.ID>(),
    space: text().$type<Space.ID>(),
    root_session: text(),
    session: text(),
    turn: text(),
    member: text(),
    agent: text(),
    payer: text().$type<Usage.Payer>().notNull(),
    provider: text().notNull(),
    cost_micro_usd: bigint({ mode: "number" }),
    error: jsonb().$type<Usage.Failure>(),
    data: jsonb().$type<Usage.Event["data"]>().notNull(),
    received_at: timestamp().defaultNow().notNull(),
    position: bigserial({ mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.id] }),
    index("usage_event_organization_time_idx").on(table.organization, table.time),
    index("usage_event_space_time_idx").on(table.space, table.time),
    index("usage_event_source_time_idx").on(table.source, table.time),
    uniqueIndex("usage_event_position_idx").on(table.position),
  ],
)
