export * as Space from "./space.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { and, asc, count, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { SpaceAccess } from "./space-access.js"
import { SpacePolicy } from "./space-policy.js"

export type Interface = Primitive.Interface<typeof Space.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/Space") {}

const notFound = new Primitive.NotFound({ message: "Space not found." })

const memberCount = sql<number>`(
  select count(*)::int from ${Database.Schema.space_member}
  where ${Database.Schema.space_member.space_id} = ${Database.Schema.space.id}
    and ${Database.Schema.space_member.archived_at} is null
)`

const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({
      space: Database.Schema.space,
      membershipId: SpaceAccess.membership.id,
      isFirst: SpaceAccess.isFirst,
      memberCount,
    })
    .from(Database.Schema.space)
    .leftJoin(SpaceAccess.membership, SpaceAccess.membershipOf(actor))

type Row = Effect.Success<ReturnType<typeof select>>[number]

const visibleTo = (policy: SpacePolicy.Interface, actor: Actor.Info, role: string) =>
  and(
    eq(Database.Schema.space.organization_id, actor.organizationId),
    isNull(Database.Schema.space.archived_at),
    policy.visibility(role) === "membership" ? isNotNull(SpaceAccess.membership.id) : undefined,
  )

const toInfo =
  (policy: SpacePolicy.Interface, role: string) =>
  (row: Row): Space.Info => {
    const access = { role, membershipId: row.membershipId, isFirst: row.isFirst }
    return {
      id: row.space.id,
      organizationId: row.space.organization_id,
      name: row.space.name,
      description: row.space.description,
      memberCount: row.memberCount,
      membershipId: row.membershipId,
      canManage: policy.canManage(access),
      canArchive: policy.canArchive(access),
      createdAt: DateTime.fromDateUnsafe(row.space.created_at),
      updatedAt: DateTime.fromDateUnsafe(row.space.updated_at),
      archivedAt: row.space.archived_at && DateTime.fromDateUnsafe(row.space.archived_at),
    }
  }

const find = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  policy: SpacePolicy.Interface,
  actor: Actor.Info,
  role: string,
  where: SQL | undefined,
) {
  const info = (yield* select(transaction, actor).where(where)).map(toInfo(policy, role)).at(0)
  if (!info) return yield* notFound
  return info
})

const list = (database: Database.Interface, policy: SpacePolicy.Interface) =>
  Effect.fn("Space.list")(function* (actor: Actor.Info, input: Space.ListInput) {
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const role = yield* SpaceAccess.organizationRole(transaction, actor)
        if (!role) return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        const where = and(
          visibleTo(policy, actor, role),
          input.joined ? isNotNull(SpaceAccess.membership.id) : undefined,
        )
        const rows = yield* select(transaction, actor)
          .where(where)
          .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize)
        const totals = yield* transaction
          .select({ total: count() })
          .from(Database.Schema.space)
          .leftJoin(SpaceAccess.membership, SpaceAccess.membershipOf(actor))
          .where(where)
        return {
          items: rows.map(toInfo(policy, role)),
          page: input.page,
          pageSize: input.pageSize,
          total: totals.at(0)?.total ?? 0,
        }
      }),
    )
  })

const get = (database: Database.Interface, policy: SpacePolicy.Interface) =>
  Effect.fn("Space.get")(function* (actor: Actor.Info, idOrSlug: string) {
    if (!Schema.is(Space.ID)(idOrSlug)) return yield* notFound
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const role = yield* SpaceAccess.organizationRole(transaction, actor)
        if (!role) return yield* notFound
        return yield* find(
          transaction,
          policy,
          actor,
          role,
          and(visibleTo(policy, actor, role), eq(Database.Schema.space.id, idOrSlug)),
        )
      }),
    )
  })

const create = (database: Database.Interface, policy: SpacePolicy.Interface) =>
  Effect.fn("Space.create")(function* (actor: Actor.Info, input: Space.CreateInput) {
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const role = yield* SpaceAccess.organizationRole(transaction, actor)
        if (!role) return yield* new Primitive.Forbidden({ message: "Join the organization to create spaces." })
        const id = Space.ID.create()
        yield* transaction.insert(Database.Schema.space).values({
          id,
          organization_id: actor.organizationId,
          name: input.name,
          description: input.description ?? null,
        })
        yield* transaction
          .insert(Database.Schema.space_member)
          .values({ id: Space.MembershipID.create(), space_id: id, user_id: actor.userId })
        return yield* find(transaction, policy, actor, role, eq(Database.Schema.space.id, id))
      }),
    )
  })

const update = (database: Database.Interface, policy: SpacePolicy.Interface) =>
  Effect.fn("Space.update")(function* (actor: Actor.Info, id: Space.ID, input: Space.UpdateInput) {
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const space = yield* SpaceAccess.load(transaction, actor, id, "update")
        if (!space || space.archivedAt || !policy.canRead(space.access)) return yield* notFound
        if (!policy.canManage(space.access)) {
          return yield* new Primitive.Forbidden({ message: "You cannot edit this space." })
        }
        yield* transaction
          .update(Database.Schema.space)
          .set({ name: input.name, description: input.description, updated_at: sql`now()` })
          .where(eq(Database.Schema.space.id, id))
        return yield* find(transaction, policy, actor, space.access.role, eq(Database.Schema.space.id, id))
      }),
    )
  })

const archive = (database: Database.Interface, policy: SpacePolicy.Interface) =>
  Effect.fn("Space.archive")(function* (actor: Actor.Info, id: Space.ID) {
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const space = yield* SpaceAccess.load(transaction, actor, id, "update")
        if (!space || !policy.canRead(space.access)) return yield* notFound
        if (space.archivedAt) {
          return yield* find(transaction, policy, actor, space.access.role, eq(Database.Schema.space.id, id))
        }
        if (!policy.canArchive(space.access)) {
          return yield* new Primitive.Forbidden({ message: "This space cannot be archived." })
        }
        yield* transaction
          .update(Database.Schema.space)
          .set({ archived_at: sql`now()`, updated_at: sql`now()` })
          .where(eq(Database.Schema.space.id, id))
        yield* transaction
          .update(Database.Schema.space_pending_member)
          .set({ archived_at: sql`now()` })
          .where(
            and(
              eq(Database.Schema.space_pending_member.space_id, id),
              isNull(Database.Schema.space_pending_member.archived_at),
            ),
          )
        return yield* find(transaction, policy, actor, space.access.role, eq(Database.Schema.space.id, id))
      }),
    )
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const policy = yield* SpacePolicy.Service
    return Service.of({
      list: list(database, policy),
      get: get(database, policy),
      create: create(database, policy),
      update: update(database, policy),
      archive: archive(database, policy),
    })
  }),
)
