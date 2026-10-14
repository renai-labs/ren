export * as Space from "./space.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { and, asc, count, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { SpaceMemberPolicy } from "./space/member-policy.js"
import { SpacePolicy } from "./space/policy.js"
import { SpaceQueries } from "./space/queries.js"

export type Interface = Primitive.Interface<typeof Space.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/Space") {}

const notFound = new Primitive.NotFound({ message: "Space not found." })

const memberCount = sql<number>`(
  select count(*)::int from ${Database.Schema.space_member}
  where ${Database.Schema.space_member.space_id} = ${Database.Schema.space.id}
    and ${Database.Schema.space_member.archived_at} is null
)`

const firstSpace = alias(Database.Schema.space, "first_space")

const isFirstOrganizationSpace = sql<boolean>`${Database.Schema.space.id} = (
  select ${firstSpace.id} from ${Database.Schema.space} as ${firstSpace}
  where ${firstSpace.organization_id} = ${Database.Schema.space.organization_id}
  order by ${firstSpace.created_at}, ${firstSpace.id}
  limit 1
)`

const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({
      space: Database.Schema.space,
      membershipId: SpaceQueries.membership.id,
      isFirstOrganizationSpace,
      memberCount,
    })
    .from(Database.Schema.space)
    .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))

type Row = Effect.Success<ReturnType<typeof select>>[number]

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const policy = yield* SpacePolicy.Service
    const memberPolicy = yield* SpaceMemberPolicy.Service

    const spaceVisibilityFilter = (actor: Actor.Info, policyContext: SpacePolicy.OrganizationContext) =>
      and(
        eq(Database.Schema.space.organization_id, actor.organizationId),
        isNull(Database.Schema.space.archived_at),
        policy.visibility(policyContext) === "membership" ? isNotNull(SpaceQueries.membership.id) : undefined,
      )

    const toInfo =
      (actor: Actor.Info, role: string | undefined) =>
      (row: Row): Space.Info => {
        const policyContext = {
          role,
          spaceId: row.space.id,
          membershipId: row.membershipId,
          isFirstOrganizationSpace: row.isFirstOrganizationSpace,
        }
        const target = row.space.id
        return {
          id: row.space.id,
          organizationId: row.space.organization_id,
          name: row.space.name,
          description: row.space.description,
          memberCount: row.memberCount,
          membershipId: row.membershipId,
          canUpdate: policy.check({
            who: actor,
            action: Primitive.action(Space.definition, "update"),
            target,
            policyContext,
          }).allowed,
          canAddMember: memberPolicy.check({
            who: actor,
            action: Primitive.action(SpaceMember.definition, "create"),
            target,
            policyContext,
          }).allowed,
          canRemoveMember: memberPolicy.canArchiveMembers(policyContext),
          canArchive: policy.check({
            who: actor,
            action: Primitive.action(Space.definition, "archive"),
            target,
            policyContext,
          }).allowed,
          createdAt: DateTime.fromDateUnsafe(row.space.created_at),
          updatedAt: DateTime.fromDateUnsafe(row.space.updated_at),
          archivedAt: row.space.archived_at && DateTime.fromDateUnsafe(row.space.archived_at),
        }
      }

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      role: string | undefined,
      where: SQL | undefined,
    ) {
      const row = (yield* select(transaction, actor).where(where)).at(0)
      if (!row) return yield* notFound
      if (
        !policy.check({
          who: actor,
          action: Primitive.action(Space.definition, "get"),
          target: row.space.id,
          policyContext: {
            role,
            membershipId: row.membershipId,
            isFirstOrganizationSpace: row.isFirstOrganizationSpace,
          },
        }).allowed
      )
        return yield* notFound
      return toInfo(actor, role)(row)
    })

    const lock = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, id: Space.ID) {
      const role = yield* SpaceQueries.organizationRole(transaction, actor)
      if (!role) return
      const rows = yield* select(transaction, actor)
        .where(and(eq(Database.Schema.space.id, id), eq(Database.Schema.space.organization_id, actor.organizationId)))
        .for("update", { of: Database.Schema.space })
      const row = rows.at(0)
      if (!row) return
      return {
        row,
        role,
        policyContext: {
          role,
          membershipId: row.membershipId,
          isFirstOrganizationSpace: row.isFirstOrganizationSpace,
        },
      }
    })

    return Service.of({
      list: Effect.fn("Space.list")(function* (actor: Actor.Info, input: Space.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const role = yield* SpaceQueries.organizationRole(transaction, actor)
            const empty = { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            if (!role) return empty
            const policyContext = { role }
            if (
              !policy.check({
                who: actor,
                action: Primitive.action(Space.definition, "list"),
                target: actor.organizationId,
                policyContext,
              }).allowed
            ) {
              return empty
            }
            const where = and(
              spaceVisibilityFilter(actor, policyContext),
              input.joined ? isNotNull(SpaceQueries.membership.id) : undefined,
            )
            const rows = yield* select(transaction, actor)
              .where(where)
              .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(Database.Schema.space)
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(where)
            return {
              items: rows.map(toInfo(actor, role)),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Space.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!Schema.is(Space.ID)(idOrSlug)) return yield* notFound
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const role = yield* SpaceQueries.organizationRole(transaction, actor)
            if (!role) return yield* notFound
            return yield* find(
              transaction,
              actor,
              role,
              and(spaceVisibilityFilter(actor, { role }), eq(Database.Schema.space.id, idOrSlug)),
            )
          }),
        )
      }),
      create: Effect.fn("Space.create")(function* (actor: Actor.Info, input: Space.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const role = yield* SpaceQueries.organizationRole(transaction, actor)
            const decision = policy.check({
              who: actor,
              action: Primitive.action(Space.definition, "create"),
              target: actor.organizationId,
              policyContext: { role },
            })
            if (!decision.allowed) return yield* new Primitive.Forbidden({ message: decision.reason })
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
            return yield* find(transaction, actor, role, eq(Database.Schema.space.id, id))
          }),
        )
      }),
      update: Effect.fn("Space.update")(function* (actor: Actor.Info, id: Space.ID, input: Space.UpdateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const locked = yield* lock(transaction, actor, id)
            if (
              !locked ||
              locked.row.space.archived_at ||
              !policy.check({
                who: actor,
                action: Primitive.action(Space.definition, "get"),
                target: id,
                policyContext: locked.policyContext,
              }).allowed
            ) {
              return yield* notFound
            }
            const decision = policy.check({
              who: actor,
              action: Primitive.action(Space.definition, "update"),
              target: id,
              policyContext: locked.policyContext,
            })
            if (!decision.allowed) return yield* new Primitive.Forbidden({ message: decision.reason })
            const updated = yield* transaction
              .update(Database.Schema.space)
              .set({ name: input.name, description: input.description, updated_at: sql`now()` })
              .where(eq(Database.Schema.space.id, id))
              .returning()
            const space = updated.at(0)
            if (!space) return yield* notFound
            return toInfo(actor, locked.role)({ ...locked.row, space })
          }),
        )
      }),
      archive: Effect.fn("Space.archive")(function* (actor: Actor.Info, id: Space.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const locked = yield* lock(transaction, actor, id)
            if (
              !locked ||
              !policy.check({
                who: actor,
                action: Primitive.action(Space.definition, "get"),
                target: id,
                policyContext: locked.policyContext,
              }).allowed
            ) {
              return yield* notFound
            }
            const info = toInfo(actor, locked.role)
            if (locked.row.space.archived_at) return info(locked.row)
            const decision = policy.check({
              who: actor,
              action: Primitive.action(Space.definition, "archive"),
              target: id,
              policyContext: locked.policyContext,
            })
            if (!decision.allowed) return yield* new Primitive.Forbidden({ message: decision.reason })
            const archived = yield* transaction
              .update(Database.Schema.space)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.space.id, id))
              .returning()
            yield* transaction
              .update(Database.Schema.space_pending_member)
              .set({ archived_at: sql`now()` })
              .where(
                and(
                  eq(Database.Schema.space_pending_member.space_id, id),
                  isNull(Database.Schema.space_pending_member.archived_at),
                ),
              )
            const space = archived.at(0)
            if (!space) return yield* notFound
            return info({ ...locked.row, space })
          }),
        )
      }),
    })
  }),
)
