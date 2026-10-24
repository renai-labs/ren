import type { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import type { Envelope } from "@ren/schema/envelope"
import type { RegisteredKey } from "@ren/schema/registered-key"
import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization, user } from "./auth.sql.js"
import { space } from "./space.sql.js"

export const credentialOwnerLabelConstraints = {
  org: "credential_org_label_uidx",
  space: "credential_space_label_uidx",
  person: "credential_person_label_uidx",
  workload: "credential_workload_label_uidx",
} as const

export const credential = pgTable(
  "credential",
  {
    id: text().$type<Credential.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    owner: text().$type<Credential.OwnerKind | "workload">().notNull(),
    user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    workload_kind: text().$type<Workload.Kind>(),
    workload_id: text(),
    label: text().notNull(),
    name: text(),
    type: text().$type<Credential.Type>().notNull(),
    value: jsonb().$type<Envelope.Sealed>().notNull(),
    key_preview: text(),
    field_names: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hosts: text().array().notNull(),
    inject: jsonb().$type<Credential.Inject>().notNull(),
    delivery: text().$type<Credential.Delivery>().notNull().default("egress"),
    account_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text().$type<Credential.Status>().notNull().default("ok"),
    expires_at: timestamp(),
    refresh_lease_at: timestamp(),
    refresh_failures: integer().notNull().default(0),
    created_by_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    check(
      "credential_owner_check",
      sql`(${table.owner} = 'org' and ${table.user_id} is null and ${table.space_id} is null and ${table.workload_kind} is null and ${table.workload_id} is null)
       or (${table.owner} = 'space' and ${table.user_id} is null and ${table.space_id} is not null and ${table.workload_kind} is null and ${table.workload_id} is null)
       or (${table.owner} = 'person' and ${table.user_id} is not null and ${table.space_id} is null and ${table.workload_kind} is null and ${table.workload_id} is null)
       or (${table.owner} = 'workload' and ${table.user_id} is null and ${table.space_id} is null and ${table.workload_kind} is not null and ${table.workload_id} is not null)`,
    ),
    uniqueIndex(credentialOwnerLabelConstraints.org)
      .on(table.organization_id, table.label)
      .where(sql`${table.owner} = 'org'`),
    uniqueIndex(credentialOwnerLabelConstraints.space)
      .on(table.space_id, table.label)
      .where(sql`${table.owner} = 'space'`),
    uniqueIndex(credentialOwnerLabelConstraints.person)
      .on(table.organization_id, table.user_id, table.label)
      .where(sql`${table.owner} = 'person'`),
    uniqueIndex(credentialOwnerLabelConstraints.workload)
      .on(table.workload_kind, table.workload_id, table.label)
      .where(sql`${table.owner} = 'workload'`),
    index("credential_expires_at_idx")
      .on(table.expires_at)
      .where(sql`${table.expires_at} is not null`),
    index("credential_account_user_id_idx").on(table.account_user_id),
  ],
)

export const credential_caller = pgTable(
  "credential_caller",
  {
    workload_kind: text().$type<Workload.Kind>().notNull(),
    workload_id: text().notNull(),
    generation: integer().notNull(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    proof_kind: text().$type<"ProxyLogin" | "Address" | "HostStamp" | "Token">().notNull(),
    username: text(),
    password_hash: text(),
    address: text(),
    revoked_at: timestamp(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workload_kind, table.workload_id, table.generation] }),
    uniqueIndex("credential_caller_username_uidx").on(table.username),
    uniqueIndex("credential_caller_address_uidx")
      .on(table.address)
      .where(sql`${table.revoked_at} is null`),
    check("credential_caller_generation_check", sql`${table.generation} >= 1`),
  ],
)

export const registered_key = pgTable(
  "registered_key",
  {
    id: text().$type<RegisteredKey.ID>().primaryKey(),
    kind: text().$type<RegisteredKey.Kind>().notNull(),
    public_key: text().notNull(),
    organization_ids: text().$type<Auth.OrganizationID>().array(),
    revoked_at: timestamp(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("registered_key_public_key_uidx").on(table.public_key)],
)
