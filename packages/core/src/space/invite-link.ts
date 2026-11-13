export * as SpaceInviteLink from "./invite-link.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { SpaceInviteLink } from "@ren/schema/space-invite-link"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { CredentialOffboarding } from "../credential/offboarding.js"
import { EgressControl } from "../egress-control.js"
import { Primitive } from "../primitive.js"
import { SpacePolicy } from "./policy.js"
import { SpaceQueries } from "./queries.js"

export interface Interface {
  readonly get: (
    actor: Actor.Info,
    spaceId: Space.ID,
  ) => Effect.Effect<SpaceInviteLink.Info, Primitive.NotFound | Primitive.Forbidden>
  readonly reset: (
    actor: Actor.Info,
    spaceId: Space.ID,
  ) => Effect.Effect<SpaceInviteLink.Info, Primitive.NotFound | Primitive.Forbidden>
  readonly preview: (userId: Auth.UserID, token: string) => Effect.Effect<SpaceInviteLink.Preview>
  readonly accept: (
    userId: Auth.UserID,
    token: string,
  ) => Effect.Effect<SpaceInviteLink.Joined, Primitive.NotFound | Primitive.Forbidden>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceInviteLink") {}

const notFound = new Primitive.NotFound({ message: "Space not found." })

const linkNotFound = new Primitive.NotFound({ message: "This link no longer works." })

const forbidden = new Primitive.Forbidden({ message: "Only members of a shared space can use its invite link." })

const newToken = () =>
  `${SpaceInviteLink.tokenPrefix}${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`

const toInfo = (row: typeof Database.Schema.space_invite_link.$inferSelect): SpaceInviteLink.Info => ({
  spaceId: row.space_id,
  token: row.token,
  uses: row.uses,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
})

const selectLink = (transaction: Database.Transaction, userId: Auth.UserID, token: string) =>
  transaction
    .select({
      linkId: Database.Schema.space_invite_link.id,
      spaceId: Database.Schema.space.id,
      slug: Database.Schema.space.slug,
      name: Database.Schema.space.name,
      organizationId: Database.Schema.organization.id,
      organizationName: Database.Schema.organization.name,
      role: Database.Schema.member.role,
      membershipId: Database.Schema.space_member.id,
    })
    .from(Database.Schema.space_invite_link)
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.space_invite_link.space_id))
    .innerJoin(Database.Schema.organization, eq(Database.Schema.organization.id, Database.Schema.space.organization_id))
    .leftJoin(
      Database.Schema.member,
      and(
        eq(Database.Schema.member.organizationId, Database.Schema.space.organization_id),
        eq(Database.Schema.member.userId, userId),
      ),
    )
    .leftJoin(
      Database.Schema.space_member,
      and(
        eq(Database.Schema.space_member.space_id, Database.Schema.space.id),
        eq(Database.Schema.space_member.user_id, userId),
        isNull(Database.Schema.space_member.archived_at),
      ),
    )
    .where(
      and(
        eq(Database.Schema.space_invite_link.token, token),
        isNull(Database.Schema.space_invite_link.archived_at),
        isNull(Database.Schema.space.archived_at),
      ),
    )

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
    ) {
      const row = (yield* transaction
        .select({
          archivedAt: Database.Schema.space.archived_at,
          kind: Database.Schema.space.kind,
          ownerUserId: Database.Schema.space.owner_user_id,
          membershipId: SpaceQueries.membership.id,
        })
        .from(Database.Schema.space)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(
          and(eq(Database.Schema.space.id, spaceId), eq(Database.Schema.space.organization_id, actor.organizationId)),
        )
        .for("update", { of: Database.Schema.space })).at(0)
      if (!row || row.archivedAt) return yield* notFound
      const resource = SpacePolicy.resource({
        membershipId: row.membershipId,
        kind: row.kind,
        isOwner: row.ownerUserId === actor.userId,
      })
      if (!access.isAllowed({ actor, action: SpacePolicy.actions.get, resource })) return yield* notFound
      if (!access.isAllowed({ actor, action: SpacePolicy.actions.inviteLink, resource })) return yield* forbidden
    })

    const liveLink = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
      return (yield* transaction
        .select()
        .from(Database.Schema.space_invite_link)
        .where(
          and(
            eq(Database.Schema.space_invite_link.space_id, spaceId),
            isNull(Database.Schema.space_invite_link.archived_at),
          ),
        )).at(0)
    })

    const createLink = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: Space.ID,
    ) {
      return (yield* transaction
        .insert(Database.Schema.space_invite_link)
        .values({
          id: SpaceInviteLink.ID.create(),
          space_id: spaceId,
          token: newToken(),
          created_by: actor.userId,
        })
        .returning()).at(0)
    })

    return Service.of({
      get: Effect.fn("SpaceInviteLink.get")(function* (actor: Actor.Info, spaceId: Space.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockSpace(transaction, actor, spaceId)
            const link = (yield* liveLink(transaction, spaceId)) ?? (yield* createLink(transaction, actor, spaceId))
            if (!link) return yield* notFound
            return toInfo(link)
          }),
        )
      }),
      reset: Effect.fn("SpaceInviteLink.reset")(function* (actor: Actor.Info, spaceId: Space.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockSpace(transaction, actor, spaceId)
            yield* transaction
              .update(Database.Schema.space_invite_link)
              .set({ archived_at: sql`now()` })
              .where(
                and(
                  eq(Database.Schema.space_invite_link.space_id, spaceId),
                  isNull(Database.Schema.space_invite_link.archived_at),
                ),
              )
            const link = yield* createLink(transaction, actor, spaceId)
            if (!link) return yield* notFound
            return toInfo(link)
          }),
        )
      }),
      preview: Effect.fn("SpaceInviteLink.preview")(function* (userId: Auth.UserID, token: string) {
        const row = (yield* database.transaction((transaction) => selectLink(transaction, userId, token))).at(0)
        if (!row) return { state: "invalid", organization: null, space: null } satisfies SpaceInviteLink.Preview
        const organization = { id: Auth.OrganizationID.make(row.organizationId), name: row.organizationName }
        if (!row.role) return { state: "outside", organization, space: null } satisfies SpaceInviteLink.Preview
        return {
          state: row.membershipId ? "member" : "joinable",
          organization,
          space: { id: row.spaceId, slug: row.slug, name: row.name },
        } satisfies SpaceInviteLink.Preview
      }),
      accept: Effect.fn("SpaceInviteLink.accept")(function* (userId: Auth.UserID, token: string) {
        const accepted = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = (yield* selectLink(transaction, userId, token).for("update", {
              of: Database.Schema.space_invite_link,
            })).at(0)
            if (!row) return yield* linkNotFound
            if (!row.role)
              return yield* new Primitive.Forbidden({
                message: `This link is for people in ${row.organizationName}. Ask an admin to invite you.`,
              })
            const joined = {
              organizationId: Auth.OrganizationID.make(row.organizationId),
              spaceId: row.spaceId,
              slug: row.slug,
            }
            if (row.membershipId) return { joined, workloads: [] }
            yield* transaction
              .insert(Database.Schema.space_member)
              .values({ id: Space.MembershipID.create(), space_id: row.spaceId, user_id: userId })
            yield* transaction
              .update(Database.Schema.space_invite_link)
              .set({ uses: sql`${Database.Schema.space_invite_link.uses} + 1` })
              .where(eq(Database.Schema.space_invite_link.id, row.linkId))
            return { joined, workloads: yield* CredentialOffboarding.spaceBrains(transaction, [row.spaceId]) }
          }),
        )
        yield* CredentialOffboarding.invalidate({ labels: [], workloads: accepted.workloads, providers: [] }).pipe(
          Effect.provideService(EgressControl.Service, control),
        )
        return accepted.joined
      }),
    })
  }),
)
