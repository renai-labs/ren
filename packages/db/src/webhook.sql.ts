import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Envelope } from "@ren/schema/envelope"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Webhook } from "@ren/schema/webhook"
import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { isNotNull, isNull, sql } from "drizzle-orm"
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { organization, user } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const webhookSlugConstraint = "webhook_space_id_slug_uidx"

export const webhookDeliveryEventConstraint = "webhook_delivery_webhook_id_event_id_uidx"

const literals = (values: ReadonlyArray<string>) => sql.raw(values.map((value) => `'${value}'`).join(", "))

export const webhook = pgTable(
  "webhook",
  {
    id: text().$type<Webhook.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    name: text().notNull(),
    owner_id: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    mode: text().$type<Webhook.Mode>().notNull().default("listening"),
    mode_reason: text().$type<Webhook.ModeReason>(),
    message: text().notNull(),
    parser: jsonb().$type<typeof Webhook.Parser.Encoded>().notNull(),
    token: jsonb().$type<Envelope.Sealed>().notNull(),
    signing_secret: jsonb().$type<Envelope.Sealed>(),
    created_by: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("webhook_space_id_idx").on(table.space_id).where(isNull(table.archived_at)),
    uniqueIndex(webhookSlugConstraint).on(table.space_id, table.slug).where(isNull(table.archived_at)),
    check("webhook_mode_check", sql`${table.mode} in (${literals(Webhook.Mode.literals)})`),
    check("webhook_mode_reason_check", sql`${table.mode_reason} in (${literals(Webhook.ModeReason.literals)})`),
  ],
)

export const webhook_delivery = pgTable(
  "webhook_delivery",
  {
    id: text().$type<WebhookDelivery.ID>().primaryKey(),
    webhook_id: text()
      .$type<Webhook.ID>()
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    received_at: timestamp().defaultNow().notNull(),
    outcome: text().$type<WebhookDelivery.Outcome>().notNull(),
    broken: boolean().notNull().default(false),
    reason: text(),
    verified: boolean().notNull(),
    event_id: text(),
    thread_key: text(),
    session_id: text().$type<Session.ID>(),
    method: text().notNull(),
    query: jsonb().$type<Readonly<Record<string, string>>>().notNull().default({}),
    headers: jsonb().$type<Readonly<Record<string, string>>>().notNull(),
    body: text(),
  },
  (table) => [
    index("webhook_delivery_webhook_id_received_at_idx").on(table.webhook_id, table.received_at),
    uniqueIndex(webhookDeliveryEventConstraint).on(table.webhook_id, table.event_id).where(isNotNull(table.event_id)),
    check("webhook_delivery_outcome_check", sql`${table.outcome} in (${literals(WebhookDelivery.Outcome.literals)})`),
  ],
)
