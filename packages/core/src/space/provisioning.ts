export * as SpaceProvisioning from "./provisioning.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { CredentialOffboarding } from "../credential/offboarding.js"
import { EgressControl } from "../egress-control.js"
import { SpaceQueries } from "./queries.js"

export interface User {
  readonly id: Auth.UserID
  readonly name: string
  readonly email: string
}

export interface Interface {
  readonly createInitialMemberships: (organizationId: Auth.OrganizationID, user: User) => Effect.Effect<void>
  readonly activatePendingMemberships: (organizationId: Auth.OrganizationID, user: User) => Effect.Effect<void>
  readonly archiveMemberships: (organizationId: Auth.OrganizationID, userId: Auth.UserID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceProvisioning") {}

const maximumOwnerNameLength = 200

const insertSpace = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  name: string,
  owner: Auth.UserID | null = null,
) {
  const id = Space.ID.create()
  yield* transaction.insert(Database.Schema.space).values({
    id,
    organization_id: organizationId,
    name,
    kind: owner ? "private" : "shared",
    owner_user_id: owner,
  })
  return id
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const control = yield* EgressControl.Service
    return Service.of({
      createInitialMemberships: Effect.fn("SpaceProvisioning.createInitialMemberships")(function* (
        organizationId: Auth.OrganizationID,
        user: User,
      ) {
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .select({ id: Database.Schema.organization.id })
              .from(Database.Schema.organization)
              .where(eq(Database.Schema.organization.id, organizationId))
              .for("no key update")
            const firstSpaceRows = yield* transaction
              .select({ id: Database.Schema.space.id })
              .from(Database.Schema.space)
              .where(eq(Database.Schema.space.organization_id, organizationId))
              .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
              .limit(1)
            const firstOrganizationSpaceId =
              firstSpaceRows.at(0)?.id ?? (yield* insertSpace(transaction, organizationId, "General Space"))
            const ownerName = user.name.trim().slice(0, maximumOwnerNameLength)
            // oxlint-disable-next-line ren/no-comments -- private-spaces rules 2, 3: one private space per person per org, made at join; a second join keeps it.
            const personalSpaceId =
              (yield* transaction
                .select({ id: Database.Schema.space.id })
                .from(Database.Schema.space)
                .where(
                  and(
                    eq(Database.Schema.space.organization_id, organizationId),
                    eq(Database.Schema.space.kind, "private"),
                    eq(Database.Schema.space.owner_user_id, user.id),
                    isNull(Database.Schema.space.archived_at),
                  ),
                )).at(0)?.id ??
              (yield* insertSpace(
                transaction,
                organizationId,
                ownerName ? `${ownerName}'s Personal Space` : "Personal Space",
                user.id,
              ))
            yield* transaction
              .insert(Database.Schema.space_member)
              .values(
                [firstOrganizationSpaceId, personalSpaceId].map((spaceId) => ({
                  id: Space.MembershipID.create(),
                  space_id: spaceId,
                  user_id: user.id,
                })),
              )
              .onConflictDoNothing()
          }),
        )
      }),
      activatePendingMemberships: Effect.fn("SpaceProvisioning.activatePendingMemberships")(function* (
        organizationId: Auth.OrganizationID,
        user: User,
      ) {
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const organizationMember = yield* SpaceQueries.organizationMember(transaction, organizationId, user.id)
            if (!organizationMember) return
            const pendingMemberships = yield* transaction
              .select({
                id: Database.Schema.space_pending_member.id,
                spaceId: Database.Schema.space_pending_member.space_id,
              })
              .from(Database.Schema.space_pending_member)
              .innerJoin(
                Database.Schema.space,
                eq(Database.Schema.space.id, Database.Schema.space_pending_member.space_id),
              )
              .where(
                and(
                  eq(Database.Schema.space.organization_id, organizationId),
                  isNull(Database.Schema.space.archived_at),
                  isNull(Database.Schema.space_pending_member.archived_at),
                  eq(Database.Schema.space_pending_member.email, Auth.normalizeEmail(user.email)),
                ),
              )
              .for("update", { of: Database.Schema.space_pending_member })
            if (pendingMemberships.length === 0) return
            yield* transaction
              .insert(Database.Schema.space_member)
              .values(
                pendingMemberships.map((pendingMembership) => ({
                  id: Space.MembershipID.create(),
                  space_id: pendingMembership.spaceId,
                  user_id: user.id,
                })),
              )
              .onConflictDoNothing()
            yield* transaction
              .update(Database.Schema.space_pending_member)
              .set({ archived_at: sql`now()` })
              .where(
                inArray(
                  Database.Schema.space_pending_member.id,
                  pendingMemberships.map((pendingMembership) => pendingMembership.id),
                ),
              )
          }),
        )
      }),
      archiveMemberships: Effect.fn("SpaceProvisioning.archiveMemberships")(function* (
        organizationId: Auth.OrganizationID,
        userId: Auth.UserID,
      ) {
        const removed = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .update(Database.Schema.space_member)
              .set({ archived_at: sql`now()` })
              .where(
                and(
                  eq(Database.Schema.space_member.user_id, userId),
                  isNull(Database.Schema.space_member.archived_at),
                  inArray(
                    Database.Schema.space_member.space_id,
                    transaction
                      .select({ id: Database.Schema.space.id })
                      .from(Database.Schema.space)
                      .where(eq(Database.Schema.space.organization_id, organizationId)),
                  ),
                ),
              )
            // oxlint-disable-next-line ren/no-comments -- private-spaces rule 16, access AC12: the person's private space goes with them, and so do the agents and apps it owns.
            const own = yield* transaction
              .update(Database.Schema.space)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(
                and(
                  eq(Database.Schema.space.organization_id, organizationId),
                  eq(Database.Schema.space.kind, "private"),
                  eq(Database.Schema.space.owner_user_id, userId),
                  isNull(Database.Schema.space.archived_at),
                ),
              )
              .returning({ id: Database.Schema.space.id })
            yield* Effect.forEach(own, (space) => SpaceQueries.archiveOwned(transaction, space.id), { discard: true })
            const spaces = yield* Effect.forEach(own, (space) => CredentialOffboarding.forSpace(transaction, space.id))
            const removed = yield* CredentialOffboarding.forMember(transaction, organizationId, userId)
            return {
              labels: [...removed.labels, ...spaces.flatMap((space) => space.labels)],
              workloads: [...removed.workloads, ...spaces.flatMap((space) => space.workloads)],
              providers: [...removed.providers, ...spaces.flatMap((space) => space.providers)],
            }
          }),
        )
        yield* CredentialOffboarding.invalidate(removed).pipe(Effect.provideService(EgressControl.Service, control))
      }),
    })
  }),
)
