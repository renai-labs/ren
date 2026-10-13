export * as SpaceProvisioning from "./space-provisioning.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

export interface User {
  readonly id: Auth.UserID
  readonly name: string
  readonly email: string
}

export interface Interface {
  readonly provisionMember: (organizationId: Auth.OrganizationID, user: User) => Effect.Effect<void>
  readonly applyAssignments: (organizationId: Auth.OrganizationID, user: User) => Effect.Effect<void>
  readonly removeMemberships: (organizationId: Auth.OrganizationID, userId: Auth.UserID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceProvisioning") {}

const maximumOwnerNameLength = 200

const insertSpace = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  name: string,
) {
  const id = Space.ID.create()
  yield* transaction.insert(Database.Schema.space).values({ id, organization_id: organizationId, name })
  return id
})

const provisionMember = (database: Database.Interface) =>
  Effect.fn("SpaceProvisioning.provisionMember")(function* (organizationId: Auth.OrganizationID, user: User) {
    yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .select({ id: Database.Schema.organization.id })
          .from(Database.Schema.organization)
          .where(eq(Database.Schema.organization.id, organizationId))
          .for("no key update")
        const spaces = yield* transaction
          .select({ id: Database.Schema.space.id })
          .from(Database.Schema.space)
          .where(eq(Database.Schema.space.organization_id, organizationId))
          .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
          .limit(1)
        const firstSpace = spaces.at(0)?.id ?? (yield* insertSpace(transaction, organizationId, "General Space"))
        const name = user.name.trim().slice(0, maximumOwnerNameLength)
        const personalSpace = yield* insertSpace(
          transaction,
          organizationId,
          name ? `${name}'s Personal Space` : "Personal Space",
        )
        yield* transaction
          .insert(Database.Schema.space_member)
          .values(
            [firstSpace, personalSpace].map((spaceId) => ({
              id: Space.MembershipID.create(),
              space_id: spaceId,
              user_id: user.id,
            })),
          )
          .onConflictDoNothing()
      }),
    )
  })

const applyAssignments = (database: Database.Interface) =>
  Effect.fn("SpaceProvisioning.applyAssignments")(function* (organizationId: Auth.OrganizationID, user: User) {
    yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const organizationMembers = yield* transaction
          .select({ id: Database.Schema.member.id })
          .from(Database.Schema.member)
          .where(
            and(eq(Database.Schema.member.organizationId, organizationId), eq(Database.Schema.member.userId, user.id)),
          )
          .for("share")
        if (organizationMembers.length === 0) return
        const assignments = yield* transaction
          .select({
            id: Database.Schema.space_pending_member.id,
            spaceId: Database.Schema.space_pending_member.space_id,
          })
          .from(Database.Schema.space_pending_member)
          .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.space_pending_member.space_id))
          .where(
            and(
              eq(Database.Schema.space.organization_id, organizationId),
              isNull(Database.Schema.space.archived_at),
              isNull(Database.Schema.space_pending_member.archived_at),
              eq(Database.Schema.space_pending_member.email, user.email.trim().toLowerCase()),
            ),
          )
          .for("update", { of: Database.Schema.space_pending_member })
        if (assignments.length === 0) return
        yield* transaction
          .insert(Database.Schema.space_member)
          .values(
            assignments.map((assignment) => ({
              id: Space.MembershipID.create(),
              space_id: assignment.spaceId,
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
              assignments.map((assignment) => assignment.id),
            ),
          )
      }),
    )
  })

const removeMemberships = (database: Database.Interface) =>
  Effect.fn("SpaceProvisioning.removeMemberships")(function* (
    organizationId: Auth.OrganizationID,
    userId: Auth.UserID,
  ) {
    yield* database.transaction((transaction) =>
      transaction
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
        ),
    )
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return Service.of({
      provisionMember: provisionMember(database),
      applyAssignments: applyAssignments(database),
      removeMemberships: removeMemberships(database),
    })
  }),
)
