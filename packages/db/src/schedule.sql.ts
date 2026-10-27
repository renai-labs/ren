import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { isNull, sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { organization, user } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const scheduleRunTimedConstraint = "schedule_run_schedule_id_scheduled_at_uidx"

export const scheduleSlugConstraint = "schedule_space_id_slug_uidx"

const literals = (values: ReadonlyArray<string>) => sql.raw(values.map((value) => `'${value}'`).join(", "))

export const schedule = pgTable(
  "schedule",
  {
    id: text().$type<Schedule.ID>().primaryKey(),
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
    cron: text(),
    time_zone: text(),
    until_at: timestamp(),
    run_at: timestamp(),
    target_session_id: text().$type<Session.ID>(),
    message: text().notNull(),
    next_run_at: timestamp(),
    paused_reason: text().$type<Schedule.PauseReason>(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("schedule_due_idx")
      .on(table.next_run_at)
      .where(sql`${table.archived_at} is null and ${table.paused_reason} is null`),
    index("schedule_space_id_idx").on(table.space_id).where(isNull(table.archived_at)),
    uniqueIndex(scheduleSlugConstraint).on(table.space_id, table.slug).where(isNull(table.archived_at)),
    check("schedule_when_check", sql`(${table.cron} is null) <> (${table.run_at} is null)`),
    check("schedule_time_zone_check", sql`(${table.cron} is null) = (${table.time_zone} is null)`),
    check("schedule_paused_reason_check", sql`${table.paused_reason} in (${literals(Schedule.PauseReason.literals)})`),
  ],
)

export const schedule_run = pgTable(
  "schedule_run",
  {
    id: text().$type<ScheduleRun.ID>().primaryKey(),
    schedule_id: text()
      .$type<Schedule.ID>()
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    scheduled_at: timestamp().notNull(),
    started_at: timestamp(),
    trigger: text().$type<ScheduleRun.Trigger>().notNull(),
    status: text().$type<ScheduleRun.Status>().notNull().default("pending"),
    reason: text().$type<ScheduleRun.Reason>(),
    error: text(),
    session_id: text().$type<Session.ID>().notNull(),
    message_id: text().$type<Session.MessageID>().notNull(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    // oxlint-disable-next-line ren/no-comments -- One timed run per fire, also when two Ren servers tick at once (schedules S1).
    uniqueIndex(scheduleRunTimedConstraint)
      .on(table.schedule_id, table.scheduled_at)
      .where(sql`${table.trigger} = 'timed'`),
    index("schedule_run_schedule_id_scheduled_at_idx").on(table.schedule_id, table.scheduled_at),
    index("schedule_run_pending_idx")
      .on(table.status)
      .where(sql`${table.status} = 'pending'`),
    check("schedule_run_trigger_check", sql`${table.trigger} in (${literals(ScheduleRun.Trigger.literals)})`),
    check("schedule_run_status_check", sql`${table.status} in (${literals(ScheduleRun.Status.literals)})`),
    check("schedule_run_reason_check", sql`${table.reason} in (${literals(ScheduleRun.Reason.literals)})`),
  ],
)
