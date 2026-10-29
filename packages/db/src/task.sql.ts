import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Label } from "@ren/schema/label"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import type { TaskComment } from "@ren/schema/task-comment"
import type { TaskEvent } from "@ren/schema/task-event"
import type { TaskLink } from "@ren/schema/task-link"
import { defineRelationsPart, isNull, type SQL, sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { agent } from "./agent.sql.js"
import { organization, user } from "./auth.sql.js"
import { agent_session } from "./session.sql.js"
import { space } from "./space.sql.js"

export const taskNumberConstraint = "task_organization_id_number_uidx"

export const labelNameConstraint = "label_organization_id_name_uidx"

export const systemLabelNameConstraint = "label_system_name_uidx"

export const spaceLabelNameConstraint = "label_space_id_name_uidx"

export const taskLinkConstraint = "task_link_task_id_kind_key_uidx"

const literals = (values: ReadonlyArray<string>) => sql.raw(values.map((value) => `'${value}'`).join(", "))

export const task = pgTable(
  "task",
  {
    id: text().$type<Task.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    parent_id: text().$type<Task.ID>(),
    number: integer().notNull(),
    title: text().notNull(),
    description: text(),
    status: text().$type<Task.Status>().notNull().default("todo"),
    priority: text().$type<Task.Priority>(),
    human_review: boolean().notNull().default(false),
    human_review_reason: text(),
    due_at: timestamp(),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    owner_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_by_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_by_agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    created_by_session_id: text()
      .$type<Session.ID>()
      .references(() => agent_session.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(taskNumberConstraint).on(table.organization_id, table.number),
    unique("task_id_space_id_unique").on(table.id, table.space_id),
    // oxlint-disable-next-line ren/no-comments -- The space in the key keeps a subtask in its parent's space, and a parent's move carries its subtasks.
    foreignKey({
      name: "task_parent_fk",
      columns: [table.parent_id, table.space_id],
      foreignColumns: [table.id, table.space_id],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    index("task_parent_id_space_id_idx").on(table.parent_id, table.space_id),
    check("task_parent_check", sql`${table.parent_id} <> ${table.id}`),
    index("task_space_id_status_idx").on(table.space_id, table.status).where(isNull(table.archived_at)),
    index("task_agent_id_idx").on(table.agent_id).where(isNull(table.archived_at)),
    index("task_owner_id_idx").on(table.owner_id).where(isNull(table.archived_at)),
    check(
      "task_title_length_check",
      sql`char_length(${table.title}) between 1 and ${sql.raw(String(Task.maximumTitleLength))}`,
    ),
    check("task_status_check", sql`${table.status} in (${literals(Task.Status.literals)})`),
    check("task_priority_check", sql`${table.priority} in (${literals(Task.Priority.literals)})`),
    check("task_human_review_check", sql`${table.human_review} = (${table.human_review_reason} is not null)`),
  ],
)

export const task_sequence = pgTable("task_sequence", {
  organization_id: text()
    .$type<Auth.OrganizationID>()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  prefix: text().notNull(),
  last_number: integer().notNull(),
})

export const label = pgTable(
  "label",
  {
    id: text().$type<Label.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .references(() => organization.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(labelNameConstraint)
      .on(table.organization_id, sql`lower(${table.name})`)
      .where(sql`${table.space_id} is null and ${table.archived_at} is null`),
    uniqueIndex(spaceLabelNameConstraint)
      .on(table.space_id, sql`lower(${table.name})`)
      .where(sql`${table.space_id} is not null and ${table.archived_at} is null`),
    check("label_space_check", sql`${table.space_id} is null or ${table.organization_id} is not null`),
    uniqueIndex(systemLabelNameConstraint)
      .on(sql`lower(${table.name})`)
      .where(sql`${table.organization_id} is null and ${table.archived_at} is null`),
    check(
      "label_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(Label.maximumNameLength))}`,
    ),
  ],
)

export const task_label = pgTable(
  "task_label",
  {
    task_id: text()
      .$type<Task.ID>()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    label_id: text()
      .$type<Label.ID>()
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.task_id, table.label_id] }),
    index("task_label_label_id_idx").on(table.label_id),
  ],
)

export const task_link = pgTable(
  "task_link",
  {
    id: text().$type<TaskLink.ID>().primaryKey(),
    task_id: text()
      .$type<Task.ID>()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text().$type<TaskLink.Kind>().notNull(),
    key: text().notNull(),
    url: text().notNull(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex(taskLinkConstraint).on(table.task_id, table.kind, table.key),
    index("task_link_organization_id_kind_key_idx").on(table.organization_id, table.kind, table.key),
  ],
)

export const task_comment = pgTable(
  "task_comment",
  {
    id: text().$type<TaskComment.ID>().primaryKey(),
    task_id: text()
      .$type<Task.ID>()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    body: text().notNull(),
    author_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    author_agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    author_session_id: text()
      .$type<Session.ID>()
      .references(() => agent_session.id, { onDelete: "set null" }),
    edited_at: timestamp(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    index("task_comment_task_id_created_at_id_idx")
      .on(table.task_id, table.created_at, table.id)
      .where(isNull(table.archived_at)),
  ],
)

export const task_event = pgTable(
  "task_event",
  {
    id: text().$type<TaskEvent.ID>().primaryKey(),
    task_id: text().$type<Task.ID>().notNull(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    data: jsonb().$type<typeof TaskEvent.Data.Encoded>().notNull(),
    kind: text()
      .$type<TaskEvent.Kind>()
      .notNull()
      .generatedAlwaysAs((): SQL => sql`${task_event.data} ->> '_tag'`),
    actor_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    actor_agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    actor_session_id: text()
      .$type<Session.ID>()
      .references(() => agent_session.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("task_event_task_id_created_at_id_idx").on(table.task_id, table.created_at, table.id),
    index("task_event_done_idx")
      .on(table.organization_id, table.created_at)
      .where(sql`${table.kind} = 'status' and ${table.data} ->> 'to' = 'done'`),
  ],
)

export const task_session = pgTable(
  "task_session",
  {
    task_id: text()
      .$type<Task.ID>()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<Session.ID>()
      .notNull()
      .references(() => agent_session.id, { onDelete: "cascade" }),
    agent_id: text()
      .$type<Agent.ID>()
      .references(() => agent.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.task_id, table.session_id] }),
    index("task_session_task_id_agent_id_created_at_idx").on(table.task_id, table.agent_id, table.created_at),
    index("task_session_session_id_idx").on(table.session_id),
  ],
)

export const taskRelations = defineRelationsPart(
  {
    organization,
    user,
    space,
    agent,
    agent_session,
    task,
    task_sequence,
    label,
    task_label,
    task_link,
    task_comment,
    task_event,
    task_session,
  },
  (r) => ({
    task: {
      organization: r.one.organization({ from: r.task.organization_id, to: r.organization.id }),
      space: r.one.space({ from: r.task.space_id, to: r.space.id }),
      agent: r.one.agent({ from: r.task.agent_id, to: r.agent.id }),
      owner: r.one.user({ from: r.task.owner_id, to: r.user.id }),
      labels: r.many.task_label({ from: r.task.id, to: r.task_label.task_id }),
      links: r.many.task_link({ from: r.task.id, to: r.task_link.task_id }),
      comments: r.many.task_comment({ from: r.task.id, to: r.task_comment.task_id }),
      sessions: r.many.task_session({ from: r.task.id, to: r.task_session.task_id }),
    },
    task_sequence: {
      organization: r.one.organization({ from: r.task_sequence.organization_id, to: r.organization.id }),
    },
    label: {
      organization: r.one.organization({ from: r.label.organization_id, to: r.organization.id }),
    },
    task_label: {
      task: r.one.task({ from: r.task_label.task_id, to: r.task.id }),
      label: r.one.label({ from: r.task_label.label_id, to: r.label.id }),
    },
    task_link: {
      task: r.one.task({ from: r.task_link.task_id, to: r.task.id }),
    },
    task_comment: {
      task: r.one.task({ from: r.task_comment.task_id, to: r.task.id }),
    },
    task_session: {
      task: r.one.task({ from: r.task_session.task_id, to: r.task.id }),
      session: r.one.agent_session({ from: r.task_session.session_id, to: r.agent_session.id }),
      agent: r.one.agent({ from: r.task_session.agent_id, to: r.agent.id }),
    },
  }),
)
