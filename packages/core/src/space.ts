export * as Space from "./space.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { and, asc, count, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
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

const actions = {
  list: Primitive.action(Space.definition, "list"),
  get: Primitive.action(Space.definition, "get"),
  create: Primitive.action(Space.definition, "create"),
  update: Primitive.action(Space.definition, "update"),
  archive: Primitive.action(Space.definition, "archive"),
  addMember: Primitive.action(SpaceMember.definition, "create"),
  removeMember: Primitive.action(SpaceMember.definition, "archive"),
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(Database.Schema.space.organization_id, actor.organizationId),
        isNull(Database.Schema.space.archived_at),
        SpacePolicy.filter(access.plan(actor, actions.get)),
      )

    const toInfo =
      (actor: Actor.Info) =>
      (row: Row): Space.Info => {
        const resource = SpacePolicy.resource(row.membershipId, row.space.id)
        const isAllowed = (action: string) => access.isAllowed({ actor, action, resource })
        return {
          id: row.space.id,
          organizationId: row.space.organization_id,
          name: row.space.name,
          description: row.space.description,
          memberCount: row.memberCount,
          membershipId: row.membershipId,
          canUpdate: isAllowed(actions.update),
          canAddMember: isAllowed(actions.addMember),
          canRemoveMember: isAllowed(actions.removeMember),
          canArchive: isAllowed(actions.archive) && !row.isFirstOrganizationSpace,
          createdAt: DateTime.fromDateUnsafe(row.space.created_at),
          updatedAt: DateTime.fromDateUnsafe(row.space.updated_at),
          archivedAt: row.space.archived_at && DateTime.fromDateUnsafe(row.space.archived_at),
        }
      }

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      where: SQL | undefined,
    ) {
      const info = (yield* select(transaction, actor).where(where)).map(toInfo(actor)).at(0)
      if (!info) return yield* notFound
      return info
    })

    const findVisible = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Space.ID,
    ) {
      const rows = yield* select(transaction, actor)
        .where(and(eq(Database.Schema.space.id, id), eq(Database.Schema.space.organization_id, actor.organizationId)))
        .for("update", { of: Database.Schema.space })
      const row = rows.at(0)
      if (!row) return
      const resource = SpacePolicy.resource(row.membershipId, row.space.id)
      if (!access.isAllowed({ actor, action: actions.get, resource })) return
      return { row, resource }
    })

    return Service.of({
      list: Effect.fn("Space.list")(function* (actor: Actor.Info, input: Space.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.list, resource: SpacePolicy.organization })) {
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            }
            const where = and(visibleTo(actor), input.joined ? isNotNull(SpaceQueries.membership.id) : undefined)
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
              items: rows.map(toInfo(actor)),
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
          find(transaction, actor, and(visibleTo(actor), eq(Database.Schema.space.id, idOrSlug))),
        )
      }),
      create: Effect.fn("Space.create")(function* (actor: Actor.Info, input: Space.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.create, resource: SpacePolicy.organization })) {
              return yield* new Primitive.Forbidden({ message: "Join the organization to create spaces." })
            }
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
            return yield* find(transaction, actor, eq(Database.Schema.space.id, id))
          }),
        )
      }),
      update: Effect.fn("Space.update")(function* (actor: Actor.Info, id: Space.ID, input: Space.UpdateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible || visible.row.space.archived_at) return yield* notFound
            if (!access.isAllowed({ actor, action: actions.update, resource: visible.resource })) {
              return yield* new Primitive.Forbidden({ message: "You cannot edit this space." })
            }
            const updated = yield* transaction
              .update(Database.Schema.space)
              .set({ name: input.name, description: input.description, updated_at: sql`now()` })
              .where(eq(Database.Schema.space.id, id))
              .returning()
            const space = updated.at(0)
            if (!space) return yield* notFound
            return toInfo(actor)({ ...visible.row, space })
          }),
        )
      }),
      archive: Effect.fn("Space.archive")(function* (actor: Actor.Info, id: Space.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible) return yield* notFound
            if (visible.row.space.archived_at) return toInfo(actor)(visible.row)
            if (
              !access.isAllowed({ actor, action: actions.archive, resource: visible.resource }) ||
              visible.row.isFirstOrganizationSpace
            ) {
              return yield* new Primitive.Forbidden({ message: "This space cannot be archived." })
            }
            const owned = yield* transaction
              .select({ name: Database.Schema.agent.name })
              .from(Database.Schema.agent)
              .where(and(eq(Database.Schema.agent.owner_space_id, id), isNull(Database.Schema.agent.archived_at)))
              .orderBy(asc(Database.Schema.agent.name))
            if (owned.length > 0)
              return yield* new Primitive.Conflict({
                message: `This space owns ${owned.map((agent) => agent.name).join(", ")}. Move or archive them first.`,
              })
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
            return toInfo(actor)({ ...visible.row, space })
          }),
        )
      }),
    })
  }),
)
