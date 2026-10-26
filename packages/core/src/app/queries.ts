export * as AppQueries from "./queries.js"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import type { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { AgentQueries } from "../agent/queries.js"
import { Primitive } from "../primitive.js"
import { AppPolicy } from "./policy.js"

export const notFound = new Primitive.NotFound({ message: "App not found." })

export const gate = { namespace: 734225 } as const

export const lock = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  options: { readonly graph?: boolean } = {},
) {
  yield* transaction
    .select({ id: Database.Schema.organization.id })
    .from(Database.Schema.organization)
    .where(eq(Database.Schema.organization.id, actor.organizationId))
    .for("update")
  if (options.graph === false) return
  // oxlint-disable-next-line ren/no-comments -- A registry publication changes apps that every organization may use: it holds this key exclusively, and organization writes share it.
  yield* transaction.execute(sql`select pg_advisory_xact_lock_shared(${gate.namespace}::int, hashtext('registry'))`)
  yield* transaction.execute(
    sql`select pg_advisory_xact_lock(${gate.namespace}::int, hashtext(${actor.organizationId}))`,
  )
})

export const registryLock = (transaction: Database.Transaction) =>
  transaction.execute(sql`select pg_advisory_xact_lock(${gate.namespace}::int, hashtext('registry'))`)

export const isListed = sql<boolean>`exists (select 1 from app_listing where app_listing.app_id = ${Database.Schema.app}.id and app_listing.archived_at is null)`

type Row = typeof Database.Schema.app.$inferSelect

export const appInfo = (row: Row, dependsOn: ReadonlyArray<string>): App.Info => ({
  id: row.id,
  slug: row.slug,
  organizationId: row.organization_id,
  ownerSpaceId: row.owner_space_id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  requiredCredentials: row.required_credentials,
  ...(row.environment && { environment: row.environment }),
  mcps: row.mcps,
  skills: row.skills,
  dependsOn,
  revision: row.revision,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

export const dependsOn = Effect.fnUntraced(function* (
  client: Pick<Database.Transaction, "select">,
  appIds: ReadonlyArray<App.ID>,
) {
  if (!appIds.length) return new Map<App.ID, ReadonlyArray<string>>()
  const rows = yield* client
    .select({ appId: Database.Schema.app_dependency.app_id, slug: Database.Schema.app.slug })
    .from(Database.Schema.app_dependency)
    .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, Database.Schema.app_dependency.dependency_app_id))
    .where(inArray(Database.Schema.app_dependency.app_id, [...appIds]))
    .orderBy(asc(Database.Schema.app.slug))
  const grouped = Map.groupBy(rows, (row) => row.appId)
  return new Map(appIds.map((id) => [id, (grouped.get(id) ?? []).map((row) => row.slug)]))
})

export const infos = Effect.fnUntraced(function* (
  client: Pick<Database.Transaction, "select">,
  rows: ReadonlyArray<Row>,
) {
  const dependencies = yield* dependsOn(
    client,
    rows.map((row) => row.id),
  )
  return rows.map((row) => appInfo(row, dependencies.get(row.id) ?? []))
})

export const info = Effect.fnUntraced(function* (client: Pick<Database.Transaction, "select">, row: Row) {
  const found = (yield* infos(client, [row])).at(0)
  if (!found) return yield* Effect.die(new Error("App info is missing"))
  return found
})

export const isOwnerMember = (actor: Actor.Info) =>
  sql<boolean>`exists (select 1 from space_member where space_id = ${Database.Schema.app}.owner_space_id and user_id = ${actor.userId} and archived_at is null)`

// oxlint-disable-next-line ren/no-comments -- profiles.md §7 rule 8: members of the owner space, the person of a private profile, and members of a space that a shared profile lists or that every space reaches.
export const isSpaceMember = (actor: Actor.Info) =>
  sql<boolean>`(${isOwnerMember(actor)} or exists (select 1 from app_profile where app_profile.app_id = ${Database.Schema.app}.id and app_profile.organization_id = ${actor.organizationId} and ((app_profile.kind = 'private' and app_profile.user_id = ${actor.userId}) or (app_profile.kind = 'shared' and (app_profile.all_spaces or exists (select 1 from app_profile_space inner join space_member on space_member.space_id = app_profile_space.space_id where app_profile_space.profile_id = app_profile.id and space_member.user_id = ${actor.userId} and space_member.archived_at is null))))))`

export const find = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  idOrSlug: string,
  options: { readonly includeArchived?: boolean } = {},
) {
  const row = (yield* transaction
    .select({
      app: Database.Schema.app,
      organizationId: Database.Schema.app.organization_id,
      isOwnerMember: isOwnerMember(actor),
      isSpaceMember: isSpaceMember(actor),
      isListed,
    })
    .from(Database.Schema.app)
    .where(
      and(
        idOrSlug.startsWith("app_")
          ? eq(Database.Schema.app.id, App.ID.make(idOrSlug))
          : eq(Database.Schema.app.slug, idOrSlug),
        or(
          eq(Database.Schema.app.organization_id, actor.organizationId),
          isListed,
          sql`exists (select 1 from app_profile where app_profile.app_id = ${Database.Schema.app}.id and app_profile.organization_id = ${actor.organizationId})`,
        ),
        options.includeArchived ? undefined : isNull(Database.Schema.app.archived_at),
      ),
    )).at(0)
  if (
    !row ||
    !access.isAllowed({ actor, action: Primitive.action(App.definition, "get"), resource: AppPolicy.resource(row) })
  )
    return yield* notFound
  return row
})

export const visibleSpace = AgentQueries.visibleSpace
