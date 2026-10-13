export * as SpaceMember from "./space-member.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { and, asc, count, eq, isNull, sql } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlError } from "effect/sql"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { SpacePermissions } from "./space-permissions.js"
import { SpaceQueries } from "./space-queries.js"

export type Interface = Primitive.Interface<typeof SpaceMember.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceMember") {}

const notFound = new Primitive.NotFound({ message: "Space member not found." })

const forbidden = new Primitive.Forbidden({ message: "You cannot manage the members of this space." })

const activeMembers = (transaction: Database.Transaction) =>
  transaction
    .select({
      id: sql<string>`${Database.Schema.space_member.id}`.as("id"),
      spaceId: Database.Schema.space_member.space_id,
      status: sql<SpaceMember.Status>`'active'`.as("status"),
      userId: sql<string | null>`${Database.Schema.space_member.user_id}`.as("user_id"),
      name: sql<string | null>`${Database.Schema.user.name}`.as("name"),
      image: Database.Schema.user.image,
      email: sql<string | null>`null`.as("email"),
      createdAt: Database.Schema.space_member.created_at,
      archivedAt: Database.Schema.space_member.archived_at,
    })
    .from(Database.Schema.space_member)
    .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.space_member.user_id))

const pendingMembers = (transaction: Database.Transaction) =>
  transaction
    .select({
      id: sql<string>`${Database.Schema.space_pending_member.id}`.as("id"),
      spaceId: Database.Schema.space_pending_member.space_id,
      status: sql<SpaceMember.Status>`'pending'`.as("status"),
      userId: sql<string | null>`null`.as("user_id"),
      name: sql<string | null>`null`.as("name"),
      image: sql<string | null>`null`.as("image"),
      email: sql<string | null>`${Database.Schema.space_pending_member.email}`.as("email"),
      createdAt: Database.Schema.space_pending_member.created_at,
      archivedAt: Database.Schema.space_pending_member.archived_at,
    })
    .from(Database.Schema.space_pending_member)

const decode = (row: Effect.Success<ReturnType<typeof pendingMembers>>[number]) =>
  Schema.decodeUnknownEffect(SpaceMember.Info)({
    ...row,
    createdAt: DateTime.fromDateUnsafe(row.createdAt),
    archivedAt: row.archivedAt && DateTime.fromDateUnsafe(row.archivedAt),
  }).pipe(Effect.orDie)

const find = Effect.fnUntraced(function* (transaction: Database.Transaction, id: SpaceMember.ID) {
  const rows = Schema.is(Space.MembershipID)(id)
    ? yield* activeMembers(transaction).where(eq(Database.Schema.space_member.id, id))
    : yield* pendingMembers(transaction).where(eq(Database.Schema.space_pending_member.id, id))
  const row = rows.at(0)
  if (!row) return yield* notFound
  return yield* decode(row)
})

const conflictOn =
  (constraint: string, message: string) =>
  (error: EffectDrizzleQueryError): Effect.Effect<never, Primitive.Conflict | EffectDrizzleQueryError> => {
    const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
    const isViolation =
      Option.isSome(failure) &&
      SqlError.isSqlError(failure.value) &&
      failure.value.reason._tag === "UniqueViolation" &&
      failure.value.reason.constraint === constraint
    return isViolation ? Effect.fail(new Primitive.Conflict({ message })) : Effect.fail(error)
  }

const addUser = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const organizationMembers = yield* transaction
    .select({ id: Database.Schema.member.id })
    .from(Database.Schema.member)
    .where(
      and(eq(Database.Schema.member.organizationId, actor.organizationId), eq(Database.Schema.member.userId, userId)),
    )
    .for("share")
  if (organizationMembers.length === 0) {
    return yield* new Primitive.Conflict({ message: "The user is not a member of this organization." })
  }
  const id = Space.MembershipID.create()
  yield* transaction
    .insert(Database.Schema.space_member)
    .values({ id, space_id: spaceId, user_id: userId })
    .pipe(
      Effect.catchTag(
        "EffectDrizzleQueryError",
        conflictOn("space_member_space_id_user_id_uidx", "The user is already a member of this space."),
      ),
    )
  return yield* find(transaction, id)
})

const addPending = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  spaceId: Space.ID,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase()
  const organizationMembers = yield* transaction
    .select({ id: Database.Schema.member.id })
    .from(Database.Schema.member)
    .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.member.userId))
    .where(
      and(
        eq(Database.Schema.member.organizationId, actor.organizationId),
        eq(sql`lower(${Database.Schema.user.email})`, normalizedEmail),
      ),
    )
  if (organizationMembers.length > 0) {
    return yield* new Primitive.Conflict({ message: "This person is already in the organization. Add them directly." })
  }
  const invitations = yield* transaction
    .select({ id: Database.Schema.invitation.id })
    .from(Database.Schema.invitation)
    .where(
      and(
        eq(Database.Schema.invitation.organizationId, actor.organizationId),
        eq(Database.Schema.invitation.status, "pending"),
        eq(sql`lower(${Database.Schema.invitation.email})`, normalizedEmail),
      ),
    )
  if (invitations.length === 0) {
    return yield* new Primitive.Conflict({ message: "Invite this person to the organization first." })
  }
  const id = Space.AssignmentID.create()
  yield* transaction
    .insert(Database.Schema.space_pending_member)
    .values({ id, space_id: spaceId, email: normalizedEmail })
    .pipe(
      Effect.catchTag(
        "EffectDrizzleQueryError",
        conflictOn("space_pending_member_space_id_email_uidx", "This email is already pending in this space."),
      ),
    )
  return yield* find(transaction, id)
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const permissions = yield* SpacePermissions.Service

    const load = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, spaceId: Space.ID) {
      const role = yield* SpaceQueries.organizationRole(transaction, actor)
      if (!role) return
      const rows = yield* transaction
        .select({ archivedAt: Database.Schema.space.archived_at, membershipId: SpaceQueries.membership.id })
        .from(Database.Schema.space)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(
          and(eq(Database.Schema.space.id, spaceId), eq(Database.Schema.space.organization_id, actor.organizationId)),
        )
        .for("share", { of: Database.Schema.space })
      const row = rows.at(0)
      if (!row) return
      return {
        archivedAt: row.archivedAt,
        access: { isAdministrator: permissions.isAdministrator(role), membershipId: row.membershipId },
      }
    })

    return Service.of({
      list: Effect.fn("SpaceMember.list")(function* (actor: Actor.Info, input: SpaceMember.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = yield* load(transaction, actor, input.spaceId)
            if (!space || space.archivedAt || !permissions.canRead(space.access)) {
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            }
            const members = activeMembers(transaction)
              .where(
                and(
                  eq(Database.Schema.space_member.space_id, input.spaceId),
                  isNull(Database.Schema.space_member.archived_at),
                ),
              )
              .unionAll(
                pendingMembers(transaction).where(
                  and(
                    eq(Database.Schema.space_pending_member.space_id, input.spaceId),
                    isNull(Database.Schema.space_pending_member.archived_at),
                  ),
                ),
              )
              .as("members")
            const where = input.status ? eq(members.status, input.status) : undefined
            const rows = yield* transaction
              .select()
              .from(members)
              .where(where)
              .orderBy(asc(members.createdAt), asc(members.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction.select({ total: count() }).from(members).where(where)
            return {
              items: yield* Effect.forEach(rows, decode),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      create: Effect.fn("SpaceMember.create")(function* (actor: Actor.Info, input: SpaceMember.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = yield* load(transaction, actor, input.spaceId)
            if (!space || space.archivedAt || !permissions.canRead(space.access)) return yield* notFound
            if (!permissions.canManageMembers(space.access)) return yield* forbidden
            if ("userId" in input) return yield* addUser(transaction, actor, input.spaceId, input.userId)
            return yield* addPending(transaction, actor, input.spaceId, input.email)
          }),
        )
      }),
      archive: Effect.fn("SpaceMember.archive")(function* (actor: Actor.Info, id: SpaceMember.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const member = yield* find(transaction, id)
            const space = yield* load(transaction, actor, member.spaceId)
            if (!space || space.archivedAt || !permissions.canRead(space.access)) return yield* notFound
            if (member.archivedAt) return member
            if (!permissions.canManageMembers(space.access)) return yield* forbidden
            const table =
              member.status === "active" ? Database.Schema.space_member : Database.Schema.space_pending_member
            yield* transaction
              .update(table)
              .set({ archived_at: sql`now()` })
              .where(and(eq(table.id, member.id), isNull(table.archived_at)))
            return yield* find(transaction, id)
          }),
        )
      }),
    })
  }),
)
