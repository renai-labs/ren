export * as SpaceMember from "./member.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { and, asc, count, eq, isNull, sql } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlError } from "effect/sql"
import { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { SpaceMemberPolicy } from "./member-policy.js"
import { SpacePolicy } from "./policy.js"
import { SpaceQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof SpaceMember.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceMember") {}

const notFound = new Primitive.NotFound({ message: "Space member not found." })

const selectMembers = (transaction: Database.Transaction) =>
  transaction
    .select({
      id: sql<string>`${Database.Schema.space_member.id}`.as("id"),
      spaceId: Database.Schema.space_member.space_id,
      status: sql<SpaceMember.Status>`'active'`.as("status"),
      userId: sql<string | null>`${Database.Schema.space_member.user_id}`.as("user_id"),
      name: sql<string | null>`${Database.Schema.user.name}`.as("name"),
      image: Database.Schema.user.image,
      email: sql<string | null>`${Database.Schema.user.email}`.as("email"),
      createdAt: Database.Schema.space_member.created_at,
      archivedAt: Database.Schema.space_member.archived_at,
    })
    .from(Database.Schema.space_member)
    .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.space_member.user_id))

const selectPendingMembers = (transaction: Database.Transaction) =>
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

const toInfo = (row: Effect.Success<ReturnType<typeof selectPendingMembers>>[number]) =>
  Schema.decodeUnknownEffect(SpaceMember.Info)({
    ...row,
    createdAt: DateTime.fromDateUnsafe(row.createdAt),
    archivedAt: row.archivedAt && DateTime.fromDateUnsafe(row.archivedAt),
  }).pipe(Effect.orDie)

const findMember = Effect.fnUntraced(function* (transaction: Database.Transaction, id: SpaceMember.ID) {
  const rows = Schema.is(Space.MembershipID)(id)
    ? yield* selectMembers(transaction).where(eq(Database.Schema.space_member.id, id))
    : yield* selectPendingMembers(transaction).where(eq(Database.Schema.space_pending_member.id, id))
  const row = rows.at(0)
  if (!row) return yield* notFound
  return yield* toInfo(row)
})

const mapUniqueConflict =
  (constraint: string, message: string) =>
  (error: EffectDrizzleQueryError): Effect.Effect<never, Primitive.Conflict | EffectDrizzleQueryError> => {
    const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
    const isMatchingUniqueViolation =
      Option.isSome(failure) &&
      SqlError.isSqlError(failure.value) &&
      failure.value.reason._tag === "UniqueViolation" &&
      failure.value.reason.constraint === constraint
    return isMatchingUniqueViolation ? Effect.fail(new Primitive.Conflict({ message })) : Effect.fail(error)
  }

const addMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const organizationMember = yield* SpaceQueries.organizationMember(transaction, actor.organizationId, userId)
  if (!organizationMember) {
    return yield* new Primitive.Conflict({ message: "The user is not a member of this organization." })
  }
  const id = Space.MembershipID.create()
  yield* transaction
    .insert(Database.Schema.space_member)
    .values({ id, space_id: spaceId, user_id: userId })
    .pipe(
      Effect.catchTag(
        "EffectDrizzleQueryError",
        mapUniqueConflict(Database.Schema.spaceMemberUserConstraint, "The user is already a member of this space."),
      ),
    )
  return yield* findMember(transaction, id)
})

const addPendingMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  spaceId: Space.ID,
  email: string,
) {
  const normalizedEmail = Auth.normalizeEmail(email)
  const existingMembers = yield* transaction
    .select({ id: Database.Schema.member.id })
    .from(Database.Schema.member)
    .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.member.userId))
    .where(
      and(
        eq(Database.Schema.member.organizationId, actor.organizationId),
        eq(sql`lower(${Database.Schema.user.email})`, normalizedEmail),
      ),
    )
  if (existingMembers.length > 0) {
    return yield* new Primitive.Conflict({ message: "This person is already in the organization. Add them directly." })
  }
  const pendingInvitations = yield* transaction
    .select({ id: Database.Schema.invitation.id })
    .from(Database.Schema.invitation)
    .where(
      and(
        eq(Database.Schema.invitation.organizationId, actor.organizationId),
        eq(Database.Schema.invitation.status, "pending"),
        eq(sql`lower(${Database.Schema.invitation.email})`, normalizedEmail),
      ),
    )
  if (pendingInvitations.length === 0) {
    return yield* new Primitive.Conflict({ message: "Invite this person to the organization first." })
  }
  const id = Space.AssignmentID.create()
  yield* transaction
    .insert(Database.Schema.space_pending_member)
    .values({ id, space_id: spaceId, email: normalizedEmail })
    .pipe(
      Effect.catchTag(
        "EffectDrizzleQueryError",
        mapUniqueConflict(
          Database.Schema.spacePendingMemberEmailConstraint,
          "This email is already pending in this space.",
        ),
      ),
    )
  return yield* findMember(transaction, id)
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const policy = yield* SpaceMemberPolicy.Service

    const lockSpaceAccessContext = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: Space.ID,
    ) {
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
      if (row.archivedAt) return
      const policyContext = { role, membershipId: row.membershipId, spaceId }
      if (!SpacePolicy.canAccess(policyContext)) return
      return policyContext
    })

    return Service.of({
      list: Effect.fn("SpaceMember.list")(function* (actor: Actor.Info, input: SpaceMember.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const policyContext = yield* lockSpaceAccessContext(transaction, actor, input.spaceId)
            if (
              !policyContext ||
              !policy.check({
                who: actor,
                action: Primitive.action(SpaceMember.definition, "list"),
                target: input.spaceId,
                policyContext,
              }).allowed
            ) {
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            }
            const members = selectMembers(transaction)
              .where(
                and(
                  eq(Database.Schema.space_member.space_id, input.spaceId),
                  isNull(Database.Schema.space_member.archived_at),
                ),
              )
              .unionAll(
                selectPendingMembers(transaction).where(
                  and(
                    eq(Database.Schema.space_pending_member.space_id, input.spaceId),
                    isNull(Database.Schema.space_pending_member.archived_at),
                  ),
                ),
              )
              .as("members")
            const statusFilter = input.status ? eq(members.status, input.status) : undefined
            const rows = yield* transaction
              .select()
              .from(members)
              .where(statusFilter)
              .orderBy(asc(members.createdAt), asc(members.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction.select({ total: count() }).from(members).where(statusFilter)
            return {
              items: yield* Effect.forEach(rows, toInfo),
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
            const policyContext = yield* lockSpaceAccessContext(transaction, actor, input.spaceId)
            if (!policyContext) return yield* notFound
            const decision = policy.check({
              who: actor,
              action: Primitive.action(SpaceMember.definition, "create"),
              target: input.spaceId,
              policyContext,
            })
            if (!decision.allowed) return yield* new Primitive.Forbidden({ message: decision.reason })
            if ("userId" in input) return yield* addMember(transaction, actor, input.spaceId, input.userId)
            return yield* addPendingMember(transaction, actor, input.spaceId, input.email)
          }),
        )
      }),
      archive: Effect.fn("SpaceMember.archive")(function* (actor: Actor.Info, id: SpaceMember.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const member = yield* findMember(transaction, id)
            const policyContext = yield* lockSpaceAccessContext(transaction, actor, member.spaceId)
            if (!policyContext) return yield* notFound
            if (member.archivedAt) return member
            const decision = policy.check({
              who: actor,
              action: Primitive.action(SpaceMember.definition, "archive"),
              target: member.id,
              policyContext,
            })
            if (!decision.allowed) return yield* new Primitive.Forbidden({ message: decision.reason })
            const table =
              member.status === "active" ? Database.Schema.space_member : Database.Schema.space_pending_member
            yield* transaction
              .update(table)
              .set({ archived_at: sql`now()` })
              .where(and(eq(table.id, member.id), isNull(table.archived_at)))
            return yield* findMember(transaction, id)
          }),
        )
      }),
    })
  }),
)
