export * as SpaceJoinRequest from "./join-request.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { SpaceJoinRequest } from "@ren/schema/space-join-request"
import { and, asc, count, eq, type SQL, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Access } from "../access.js"
import { Actor } from "../actor.js"
import { CredentialOffboarding } from "../credential/offboarding.js"
import { EgressControl } from "../egress-control.js"
import { Primitive } from "../primitive.js"
import { SpacePolicy } from "./policy.js"
import { SpaceQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof SpaceJoinRequest.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceJoinRequest") {}

const actions = SpacePolicy.joinRequestActions

const notFound = new Primitive.NotFound({ message: "Join request not found." })

const select = (transaction: Database.Transaction) =>
  transaction
    .select({
      id: Database.Schema.space_join_request.id,
      spaceId: Database.Schema.space_join_request.space_id,
      userId: Database.Schema.space_join_request.user_id,
      name: Database.Schema.user.name,
      email: Database.Schema.user.email,
      image: Database.Schema.user.image,
      note: Database.Schema.space_join_request.note,
      status: Database.Schema.space_join_request.status,
      decidedBy: Database.Schema.space_join_request.decided_by,
      createdAt: Database.Schema.space_join_request.created_at,
      decidedAt: Database.Schema.space_join_request.decided_at,
    })
    .from(Database.Schema.space_join_request)
    .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.space_join_request.user_id))
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.space_join_request.space_id))

const toInfo = (row: Effect.Success<ReturnType<typeof select>>[number]) =>
  Schema.decodeUnknownEffect(SpaceJoinRequest.Info)({
    ...row,
    createdAt: DateTime.fromDateUnsafe(row.createdAt),
    decidedAt: row.decidedAt && DateTime.fromDateUnsafe(row.decidedAt),
  }).pipe(Effect.orDie)

const find = Effect.fnUntraced(function* (transaction: Database.Transaction, id: SpaceJoinRequest.ID) {
  const row = (yield* select(transaction).where(eq(Database.Schema.space_join_request.id, id))).at(0)
  if (!row) return yield* notFound
  return yield* toInfo(row)
})

const admit = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  request: { readonly spaceId: Space.ID; readonly userId: Auth.UserID },
) {
  const organizationMember = yield* SpaceQueries.organizationMember(transaction, actor.organizationId, request.userId)
  if (!organizationMember)
    return yield* new Primitive.Conflict({ message: "The person is no longer in this organization." })
  return yield* CredentialOffboarding.spaceBrains(
    transaction,
    yield* SpaceQueries.admit(transaction, request.userId, [request.spaceId]),
  )
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const control = yield* EgressControl.Service

    const lockSpace = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: Space.ID,
      requesterId?: Auth.UserID,
    ) {
      const row = (yield* transaction
        .select({
          kind: Database.Schema.space.kind,
          ownerUserId: Database.Schema.space.owner_user_id,
          membershipId: SpaceQueries.membership.id,
        })
        .from(Database.Schema.space)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(
          and(
            eq(Database.Schema.space.id, spaceId),
            eq(Database.Schema.space.organization_id, actor.organizationId),
            sql`${Database.Schema.space.archived_at} is null`,
          ),
        )
        .for("share", { of: Database.Schema.space })).at(0)
      if (!row) return
      const resource = SpacePolicy.resource({
        membershipId: row.membershipId,
        kind: row.kind,
        isOwner: row.ownerUserId === actor.userId,
        isRequester: requesterId === actor.userId,
      })
      if (!access.isAllowed({ actor, action: SpacePolicy.actions.get, resource })) return
      return resource
    })

    const decide = Effect.fnUntraced(function* (
      actor: Actor.Info,
      id: SpaceJoinRequest.ID,
      action: typeof actions.approve | typeof actions.decline | typeof actions.cancel,
      status: Exclude<SpaceJoinRequest.Status, "pending">,
    ) {
      const decided = yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const found = (yield* transaction
            .select({
              spaceId: Database.Schema.space_join_request.space_id,
              userId: Database.Schema.space_join_request.user_id,
            })
            .from(Database.Schema.space_join_request)
            .where(eq(Database.Schema.space_join_request.id, id))).at(0)
          if (!found) return yield* notFound
          const resource = yield* lockSpace(transaction, actor, found.spaceId, found.userId)
          if (!resource) return yield* notFound
          const request = (yield* select(transaction)
            .where(eq(Database.Schema.space_join_request.id, id))
            .for("update", { of: Database.Schema.space_join_request })).at(0)
          if (!request) return yield* notFound
          if (!access.isAllowed({ actor, action, resource })) {
            if (
              resource.facts.includes(SpacePolicy.facts.member) ||
              resource.facts.includes(SpacePolicy.facts.requester)
            )
              return yield* new Primitive.Forbidden({ message: "You cannot decide this request." })
            return yield* notFound
          }
          if (request.status !== "pending")
            return yield* new Primitive.Conflict({ message: `This request is already ${request.status}.` })
          yield* transaction
            .update(Database.Schema.space_join_request)
            .set({ status, decided_by: actor.userId, decided_at: sql`now()` })
            .where(eq(Database.Schema.space_join_request.id, id))
          const workloads = status === "approved" ? yield* admit(transaction, actor, request) : []
          return { request: yield* find(transaction, id), workloads }
        }),
      )
      yield* CredentialOffboarding.invalidate({ labels: [], workloads: decided.workloads, providers: [] }).pipe(
        Effect.provideService(EgressControl.Service, control),
      )
      return decided.request
    })

    return Service.of({
      list: Effect.fn("SpaceJoinRequest.list")(function* (actor: Actor.Info, input: SpaceJoinRequest.ListInput) {
        const empty = { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const scope: SQL | undefined = input.spaceId
              ? eq(Database.Schema.space_join_request.space_id, input.spaceId)
              : eq(Database.Schema.space_join_request.user_id, actor.userId)
            if (input.spaceId) {
              const resource = yield* lockSpace(transaction, actor, input.spaceId)
              if (!resource || !access.isAllowed({ actor, action: actions.list, resource })) return empty
            } else if (!access.isAllowed({ actor, action: actions.listOwn, resource: Access.organization })) {
              return empty
            }
            const where = and(
              scope,
              eq(Database.Schema.space.organization_id, actor.organizationId),
              input.status ? eq(Database.Schema.space_join_request.status, input.status) : undefined,
            )
            const rows = yield* select(transaction)
              .where(where)
              .orderBy(asc(Database.Schema.space_join_request.created_at), asc(Database.Schema.space_join_request.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(Database.Schema.space_join_request)
              .innerJoin(
                Database.Schema.space,
                eq(Database.Schema.space.id, Database.Schema.space_join_request.space_id),
              )
              .where(where)
            return {
              items: yield* Effect.forEach(rows, toInfo),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      create: Effect.fn("SpaceJoinRequest.create")(function* (actor: Actor.Info, input: SpaceJoinRequest.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const resource = yield* lockSpace(transaction, actor, input.spaceId)
            if (!resource) return yield* new Primitive.NotFound({ message: "Space not found." })
            if (!access.isAllowed({ actor, action: actions.create, resource }))
              return yield* resource.facts.includes(SpacePolicy.facts.member)
                ? new Primitive.Conflict({ message: "You are already a member of this space." })
                : new Primitive.Forbidden({ message: "You cannot ask to join this space." })
            const id = Space.JoinRequestID.create()
            yield* transaction
              .insert(Database.Schema.space_join_request)
              .values({
                id,
                space_id: input.spaceId,
                user_id: actor.userId,
                note: input.note?.trim() || null,
              })
              .pipe(
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict(
                    Database.Schema.spaceJoinRequestPendingConstraint,
                    "You already asked to join this space.",
                  ),
                ),
              )
            return yield* find(transaction, id)
          }),
        )
      }),
      approve: Effect.fn("SpaceJoinRequest.approve")(function* (actor: Actor.Info, id: SpaceJoinRequest.ID) {
        return yield* decide(actor, id, actions.approve, "approved")
      }),
      decline: Effect.fn("SpaceJoinRequest.decline")(function* (actor: Actor.Info, id: SpaceJoinRequest.ID) {
        return yield* decide(actor, id, actions.decline, "declined")
      }),
      cancel: Effect.fn("SpaceJoinRequest.cancel")(function* (actor: Actor.Info, id: SpaceJoinRequest.ID) {
        return yield* decide(actor, id, actions.cancel, "cancelled")
      }),
    })
  }),
)
