import type { Agent } from "@ren/schema/agent"
import type { App } from "@ren/schema/app"
import type { Auth } from "@ren/schema/auth"
import type { Envelope } from "@ren/schema/envelope"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Webhook } from "@ren/schema/webhook"
import { isNull, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { app } from "./app.sql.js"
import { organization, user } from "./auth.sql.js"
import { agent_session } from "./session.sql.js"
import { space } from "./space.sql.js"

export const webhookSlugConstraint = "webhook_space_id_slug_uidx"

export const webhookPresetConstraint = "webhook_space_id_app_id_preset_uidx"

export const webhookRequestEventConstraint = "webhook_request_webhook_id_event_id_uidx"

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
    name: text(),
    message: text(),
    parser: jsonb().$type<typeof Webhook.Parser.Encoded>(),
    app_id: text()
      .$type<App.ID>()
      .references(() => app.id),
    preset: text(),
    owner_id: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fallback_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    mode: text().$type<Webhook.Mode>().notNull().default("listening"),
    mode_reason: text().$type<Webhook.ModeReason>(),
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
    uniqueIndex(webhookPresetConstraint)
      .on(table.space_id, table.app_id, table.preset)
      .where(sql`${table.archived_at} is null and ${table.app_id} is not null`),
    check(
      "webhook_source_check",
      sql`(${table.app_id} is null and ${table.preset} is null and ${table.name} is not null and ${table.message} is not null and ${table.parser} is not null) or (${table.app_id} is not null and ${table.preset} is not null and ${table.name} is null and ${table.message} is null and ${table.parser} is null)`,
    ),
    check("webhook_mode_check", sql`${table.mode} in (${literals(Webhook.Mode.literals)})`),
    check("webhook_mode_reason_check", sql`${table.mode_reason} in (${literals(Webhook.ModeReason.literals)})`),
  ],
)

export const webhook_request = pgTable(
  "webhook_request",
  {
    id: text().$type<Webhook.RequestID>().primaryKey(),
    webhook_id: text()
      .$type<Webhook.ID>()
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    received_at: timestamp().defaultNow().notNull(),
    outcome: text().$type<Webhook.RequestOutcome>().notNull(),
    broken: boolean().notNull().default(false),
    reason: text(),
    verified: boolean().notNull(),
    event_id: text(),
    thread_key: text(),
    session_id: text()
      .$type<Session.ID>()
      .references(() => agent_session.id, { onDelete: "set null" }),
    replays: integer().notNull().default(0),
    method: text().notNull(),
    query: jsonb().$type<Readonly<Record<string, string>>>().notNull().default({}),
    headers: jsonb().$type<Readonly<Record<string, string>>>().notNull(),
    body: text(),
  },
  (table) => [
    index("webhook_request_webhook_id_received_at_idx").on(table.webhook_id, table.received_at),
    index("webhook_request_session_id_idx").on(table.session_id),
    uniqueIndex(webhookRequestEventConstraint)
      .on(table.webhook_id, table.event_id)
      .where(sql`${table.event_id} is not null and ${table.outcome} <> 'duplicate'`),
    check("webhook_request_outcome_check", sql`${table.outcome} in (${literals(Webhook.RequestOutcome.literals)})`),
  ],
)
