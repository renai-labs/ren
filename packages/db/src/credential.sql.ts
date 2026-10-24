import type { App } from "@ren/schema/app"
import type { AppRelease } from "@ren/schema/app-release"
import type { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import type { Envelope } from "@ren/schema/envelope"
import type { OAuthApp } from "@ren/schema/oauth-app"
import type { OAuthSession } from "@ren/schema/oauth-session"
import type { RegisteredKey } from "@ren/schema/registered-key"
import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { app, app_release } from "./app.sql.js"
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
    revision: integer().notNull().default(1),
    provider: text().$type<Credential.Provider>(),
    provider_account_id: text(),
    oauth_app_id: text()
      .$type<OAuthApp.ID>()
      .references(() => oauth_app.id),
    app_id: text()
      .$type<App.ID>()
      .references(() => app.id),
    mcp: text(),
    connection: text(),
    account_subject_hash: text(),
    unauthorized_refresh_at: timestamp(),
    wanted_scopes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    index("credential_app_id_mcp_idx").on(table.app_id, table.mcp),
  ],
)

export const oauth_app = pgTable(
  "oauth_app",
  {
    id: text().$type<OAuthApp.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    provider: text(),
    client_id: text().notNull(),
    client_secret: jsonb().$type<Envelope.Sealed>(),
    scopes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    discovery: text().$type<OAuthApp.Discovery>().notNull().default("live"),
    authorization_endpoint: text(),
    token_endpoint: text(),
    token_endpoint_auth: text().$type<OAuthApp.TokenEndpointAuth>().notNull(),
    resource: text(),
    authorize_params: jsonb()
      .$type<Readonly<Record<string, string>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    pkce: boolean().notNull().default(true),
    configured_by_user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "set null" }),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex("oauth_app_name_uidx")
      .on(table.organization_id, table.name)
      .where(sql`${table.provider} is null and ${table.archived_at} is null`),
    uniqueIndex("oauth_app_provider_uidx")
      .on(table.organization_id, table.provider)
      .where(sql`${table.provider} is not null and ${table.archived_at} is null`),
  ],
)

export const oauth_session = pgTable(
  "oauth_session",
  {
    id: text().$type<OAuthSession.ID>().primaryKey(),
    organization_id: text()
      .$type<Auth.OrganizationID>()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    owner: text().$type<Credential.OwnerKind>().notNull(),
    user_id: text()
      .$type<Auth.UserID>()
      .references(() => user.id, { onDelete: "cascade" }),
    space_id: text()
      .$type<Space.ID>()
      .references(() => space.id, { onDelete: "cascade" }),
    label: text().notNull(),
    name: text(),
    credential_id: text().$type<Credential.ID>().notNull(),
    app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
    release_id: text()
      .$type<AppRelease.ID>()
      .notNull()
      .references(() => app_release.id),
    mcp: text().notNull(),
    connection: text(),
    initiator_user_id: text()
      .$type<Auth.UserID>()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    oauth_app_id: text()
      .$type<OAuthApp.ID>()
      .references(() => oauth_app.id),
    state: text().notNull(),
    code_verifier: text(),
    scope: text(),
    resource: text(),
    issuer: text(),
    client_info: jsonb().$type<Envelope.Sealed>(),
    discovery_state: jsonb().$type<Readonly<Record<string, unknown>>>(),
    status: text().$type<OAuthSession.Status>().notNull().default("pending"),
    failure_reason: text(),
    same_account_as: text(),
    created_at: timestamp().defaultNow().notNull(),
    expires_at: timestamp().notNull(),
    consumed_at: timestamp(),
  },
  (table) => [
    uniqueIndex("oauth_session_state_uidx").on(table.state),
    index("oauth_session_expires_at_idx").on(table.expires_at),
    check(
      "oauth_session_owner_check",
      sql`(${table.owner} = 'org' and ${table.user_id} is null and ${table.space_id} is null)
       or (${table.owner} = 'space' and ${table.user_id} is null and ${table.space_id} is not null)
       or (${table.owner} = 'person' and ${table.user_id} is not null and ${table.space_id} is null)`,
    ),
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
    password_sealed: jsonb().$type<Envelope.Sealed>(),
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
