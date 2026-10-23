export * as AppQueries from "./queries.js"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import type { AppRelease } from "@ren/schema/app-release"
import { SpaceApp } from "@ren/schema/space-app"
import type { Space } from "@ren/schema/space"
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
  if (options.graph !== false)
    yield* transaction.execute(
      sql`select pg_advisory_xact_lock(${gate.namespace}::int, hashtext(${actor.organizationId}))`,
    )
})

export const appInfo = (row: typeof Database.Schema.app.$inferSelect): App.Info => {
  return {
    id: row.id,
    slug: row.slug,
    organizationId: row.organization_id,
    ownerSpaceId: row.owner_space_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    latestReleaseId: row.latest_release_id,
    createdAt: DateTime.fromDateUnsafe(row.created_at),
    updatedAt: DateTime.fromDateUnsafe(row.updated_at),
    archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
  }
}

export const releaseInfos = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  rows: ReadonlyArray<typeof Database.Schema.app_release.$inferSelect>,
) {
  if (!rows.length) return new Map<AppRelease.ID, AppRelease.Info>()
  const dependencies = yield* transaction
    .select({ releaseId: Database.Schema.app_release_dependency.app_release_id, slug: Database.Schema.app.slug })
    .from(Database.Schema.app_release_dependency)
    .innerJoin(
      Database.Schema.app,
      eq(Database.Schema.app.id, Database.Schema.app_release_dependency.dependency_app_id),
    )
    .where(
      inArray(
        Database.Schema.app_release_dependency.app_release_id,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(Database.Schema.app.slug))
  const byRelease = Map.groupBy(dependencies, (entry) => entry.releaseId)
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        appId: row.app_id,
        version: row.version,
        requiredCredentials: row.required_credentials,
        ...(row.environment && { environment: row.environment }),
        mcps: row.mcps,
        skills: row.skills,
        dependsOn: (byRelease.get(row.id) ?? []).map((entry) => entry.slug),
        createdAt: DateTime.fromDateUnsafe(row.created_at),
      },
    ]),
  )
})

export const releaseInfo = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  row: typeof Database.Schema.app_release.$inferSelect,
) {
  const info = (yield* releaseInfos(transaction, [row])).get(row.id)
  if (!info) return yield* Effect.die(new Error("Release info is missing"))
  return info
})

export const isOwnerMember = (actor: Actor.Info) =>
  sql<boolean>`exists (select 1 from space_member where space_id = ${Database.Schema.app}.owner_space_id and user_id = ${actor.userId} and archived_at is null)`
export const isSpaceMember = (actor: Actor.Info) =>
  sql<boolean>`(${isOwnerMember(actor)} or exists (select 1 from space_app inner join space_member on space_member.space_id = space_app.space_id where space_app.app_id = ${Database.Schema.app}.id and space_app.archived_at is null and space_member.user_id = ${actor.userId} and space_member.archived_at is null))`
export const isInSpace = (spaceId: Space.ID) =>
  or(
    eq(Database.Schema.app.owner_space_id, spaceId),
    sql`exists (select 1 from space_app where app_id = ${Database.Schema.app}.id and space_id = ${spaceId} and archived_at is null)`,
  )

export const activeUse = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  spaceId: Space.ID,
  appId: App.ID,
) {
  return (yield* transaction
    .select()
    .from(Database.Schema.space_app)
    .where(
      and(
        eq(Database.Schema.space_app.space_id, spaceId),
        eq(Database.Schema.space_app.app_id, appId),
        isNull(Database.Schema.space_app.archived_at),
      ),
    )).at(0)
})

export const inSpace = (client: Pick<Database.Transaction, "select">, spaceId: Space.ID) =>
  client
    .select({ app: Database.Schema.app, use: Database.Schema.space_app, release: Database.Schema.app_release })
    .from(Database.Schema.app)
    .leftJoin(
      Database.Schema.space_app,
      and(
        eq(Database.Schema.space_app.app_id, Database.Schema.app.id),
        eq(Database.Schema.space_app.space_id, spaceId),
        isNull(Database.Schema.space_app.archived_at),
      ),
    )
    .innerJoin(
      Database.Schema.app_release,
      eq(
        Database.Schema.app_release.id,
        sql`coalesce(${Database.Schema.space_app.pinned_release_id}, ${Database.Schema.app.latest_release_id})`,
      ),
    )
    .where(
      and(
        isNull(Database.Schema.app.archived_at),
        or(eq(Database.Schema.app.owner_space_id, spaceId), sql`${Database.Schema.space_app.id} is not null`),
      ),
    )
    .orderBy(asc(Database.Schema.app.slug))

export const consumers = Effect.fnUntraced(function* (transaction: Database.Transaction, appId: App.ID) {
  return (yield* transaction
    .select({ id: Database.Schema.space.id })
    .from(Database.Schema.space)
    .where(
      and(
        isNull(Database.Schema.space.archived_at),
        or(
          sql`exists (select 1 from app where id = ${appId} and owner_space_id = ${Database.Schema.space.id})`,
          sql`exists (select 1 from space_app where app_id = ${appId} and space_id = ${Database.Schema.space.id} and archived_at is null and pinned_release_id is null)`,
        ),
      ),
    )).map((row) => row.id)
})

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
      isOwnerMember: isOwnerMember(actor),
      isSpaceMember: isSpaceMember(actor),
    })
    .from(Database.Schema.app)
    .where(
      and(
        idOrSlug.startsWith("app_")
          ? eq(Database.Schema.app.id, App.ID.make(idOrSlug))
          : eq(Database.Schema.app.slug, idOrSlug),
        or(
          eq(Database.Schema.app.organization_id, actor.organizationId),
          sql`exists (select 1 from space_app inner join space on space.id = space_app.space_id where space_app.app_id = ${Database.Schema.app}.id and space_app.archived_at is null and space.organization_id = ${actor.organizationId})`,
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

export const findOwned = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  idOrSlug: string,
  options: { readonly includeArchived?: boolean } = {},
) {
  const row = yield* find(transaction, access, actor, idOrSlug, options)
  if (row.app.organization_id !== actor.organizationId)
    return yield* new Primitive.Forbidden({ message: "A listed app can be read and installed, not changed." })
  return row
})

export const visibleSpace = AgentQueries.visibleSpace

export const selectedRelease = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  app: typeof Database.Schema.app.$inferSelect,
  pinnedReleaseId: AppRelease.ID | null | undefined,
) {
  const release = (yield* transaction
    .select()
    .from(Database.Schema.app_release)
    .where(
      and(
        eq(Database.Schema.app_release.app_id, app.id),
        eq(Database.Schema.app_release.id, pinnedReleaseId ?? app.latest_release_id),
      ),
    )).at(0)
  if (!release) return yield* new Primitive.Conflict({ message: "The release pin does not belong to this app." })
  return release
})

export const relationship = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  app: typeof Database.Schema.app.$inferSelect,
  spaceId: Space.ID,
  use?: typeof Database.Schema.space_app.$inferSelect,
  release?: AppRelease.Info,
) {
  return {
    id: use?.id ?? SpaceApp.ofOwner(app.id),
    spaceId,
    appId: app.id,
    isOwner: !use,
    pinnedReleaseId: use?.pinned_release_id ?? null,
    app: appInfo(app),
    release:
      release ??
      (yield* releaseInfo(
        transaction,
        yield* selectedRelease(transaction, app, use?.pinned_release_id).pipe(Effect.orDie),
      )),
    createdAt: DateTime.fromDateUnsafe(use?.created_at ?? app.created_at),
    archivedAt: use?.archived_at ? DateTime.fromDateUnsafe(use.archived_at) : null,
  }
})
