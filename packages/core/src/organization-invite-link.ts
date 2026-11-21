export * as OrganizationInviteLink from "./organization-invite-link.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { OrganizationInviteLink } from "@ren/schema/organization-invite-link"
import type { Space } from "@ren/schema/space"
import { and, asc, desc, eq, gt, inArray, isNull, type SQL, sql } from "drizzle-orm"
import { Clock, Context, DateTime, Duration, Effect, Layer } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { CredentialOffboarding } from "./credential/offboarding.js"
import { EgressControl } from "./egress-control.js"
import { OrganizationInviteLinkPolicy } from "./organization-invite-link/policy.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"

export interface Interface {
  readonly create: (
    actor: Actor.Info,
    input: OrganizationInviteLink.CreateInput,
  ) => Effect.Effect<OrganizationInviteLink.Info, Primitive.Forbidden | Primitive.Invalid>
  readonly list: (actor: Actor.Info) => Effect.Effect<ReadonlyArray<OrganizationInviteLink.Info>, Primitive.Forbidden>
  readonly revoke: (
    actor: Actor.Info,
    id: OrganizationInviteLink.ID,
  ) => Effect.Effect<void, Primitive.NotFound | Primitive.Forbidden>
  readonly preview: (token: string) => Effect.Effect<OrganizationInviteLink.Preview>
  readonly accept: (
    userId: Auth.UserID,
    token: string,
    addMember: (organizationId: Auth.OrganizationID) => Effect.Effect<void>,
  ) => Effect.Effect<OrganizationInviteLink.Joined, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/OrganizationInviteLink") {}

const linkNotFound = new Primitive.NotFound({ message: "This link no longer works." })

const expiries = {
  "1d": Duration.days(1),
  "7d": Duration.days(7),
  "30d": Duration.days(30),
} as const satisfies Record<OrganizationInviteLink.Expiry, Duration.Duration>

const newToken = () =>
  `${OrganizationInviteLink.tokenPrefix}${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`

const firstSpace = (transaction: Database.Transaction, organizationId: Auth.OrganizationID) =>
  transaction
    .select({ id: Database.Schema.space.id })
    .from(Database.Schema.space)
    .where(eq(Database.Schema.space.organization_id, organizationId))
    .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
    .limit(1)

const liveSpaces = (transaction: Database.Transaction, ids: ReadonlyArray<Space.ID>) =>
  transaction
    .select({ id: Database.Schema.space.id, name: Database.Schema.space.name, slug: Database.Schema.space.slug })
    .from(Database.Schema.space)
    .where(
      and(
        inArray(Database.Schema.space.id, [...ids]),
        eq(Database.Schema.space.kind, "shared"),
        isNull(Database.Schema.space.archived_at),
      ),
    )
    .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const control = yield* EgressControl.Service

    const infos = Effect.fnUntraced(function* (transaction: Database.Transaction, where: SQL | undefined) {
      const links = yield* transaction
        .select({
          link: Database.Schema.organization_invite_link,
          creatorName: Database.Schema.user.name,
        })
        .from(Database.Schema.organization_invite_link)
        .innerJoin(
          Database.Schema.user,
          eq(Database.Schema.user.id, Database.Schema.organization_invite_link.created_by),
        )
        .where(where)
        .orderBy(
          desc(Database.Schema.organization_invite_link.created_at),
          desc(Database.Schema.organization_invite_link.id),
        )
      if (links.length === 0) return []
      const spaces = yield* liveSpaces(
        transaction,
        links.flatMap((row) => row.link.space_ids),
      )
      return links.map(
        (row) =>
          ({
            id: row.link.id,
            token: row.link.token,
            spaces: spaces
              .filter((space) => row.link.space_ids.includes(space.id))
              .map((space) => ({ id: space.id, name: space.name })),
            createdBy: { id: row.link.created_by, name: row.creatorName },
            uses: row.link.uses,
            expiresAt: DateTime.fromDateUnsafe(row.link.expires_at),
            createdAt: DateTime.fromDateUnsafe(row.link.created_at),
          }) satisfies OrganizationInviteLink.Info,
      )
    })

    return Service.of({
      create: Effect.fn("OrganizationInviteLink.create")(function* (
        actor: Actor.Info,
        input: OrganizationInviteLink.CreateInput,
      ) {
        if (
          !access.isAllowed({
            actor,
            action: OrganizationInviteLinkPolicy.actions.create,
            resource: Access.organization,
          })
        )
          return yield* new Primitive.Forbidden({ message: "Only organization admins can create invite links." })
        const now = yield* Clock.currentTimeMillis
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const chosen = [...new Set(input.spaceIds)]
            const reachable =
              chosen.length === 0
                ? []
                : yield* transaction
                    .select({ id: Database.Schema.space.id })
                    .from(Database.Schema.space)
                    .innerJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
                    .where(
                      and(
                        eq(Database.Schema.space.organization_id, actor.organizationId),
                        eq(Database.Schema.space.kind, "shared"),
                        isNull(Database.Schema.space.archived_at),
                        inArray(Database.Schema.space.id, chosen),
                      ),
                    )
            if (reachable.length !== chosen.length)
              return yield* new Primitive.Invalid({
                message: "Choose shared spaces that you are in.",
                field: "spaceIds",
              })
            const first = (yield* firstSpace(transaction, actor.organizationId)).at(0)
            if (!first) return yield* new Primitive.Invalid({ message: "The organization has no spaces." })
            const id = OrganizationInviteLink.ID.create()
            yield* transaction.insert(Database.Schema.organization_invite_link).values({
              id,
              organization_id: actor.organizationId,
              token: newToken(),
              created_by: actor.userId,
              space_ids: [...new Set([first.id, ...chosen])],
              expires_at: new Date(now + Duration.toMillis(expiries[input.expiresIn])),
            })
            const created = (yield* infos(transaction, eq(Database.Schema.organization_invite_link.id, id))).at(0)
            if (!created) return yield* Effect.die(new Error("The invite link vanished after it was made."))
            return created
          }),
        )
      }),
      list: Effect.fn("OrganizationInviteLink.list")(function* (actor: Actor.Info) {
        if (
          !access.isAllowed({ actor, action: OrganizationInviteLinkPolicy.actions.list, resource: Access.organization })
        )
          return yield* new Primitive.Forbidden({ message: "Only organization admins can list invite links." })
        const now = new Date(yield* Clock.currentTimeMillis)
        return yield* database.transaction((transaction) =>
          infos(
            transaction,
            and(
              eq(Database.Schema.organization_invite_link.organization_id, actor.organizationId),
              isNull(Database.Schema.organization_invite_link.revoked_at),
              gt(Database.Schema.organization_invite_link.expires_at, now),
            ),
          ),
        )
      }),
      revoke: Effect.fn("OrganizationInviteLink.revoke")(function* (actor: Actor.Info, id: OrganizationInviteLink.ID) {
        if (
          !access.isAllowed({
            actor,
            action: OrganizationInviteLinkPolicy.actions.revoke,
            resource: Access.organization,
          })
        )
          return yield* new Primitive.Forbidden({ message: "Only organization admins can revoke invite links." })
        const revoked = yield* database.transaction((transaction) =>
          transaction
            .update(Database.Schema.organization_invite_link)
            .set({ revoked_at: sql`now()` })
            .where(
              and(
                eq(Database.Schema.organization_invite_link.id, id),
                eq(Database.Schema.organization_invite_link.organization_id, actor.organizationId),
                isNull(Database.Schema.organization_invite_link.revoked_at),
              ),
            )
            .returning({ id: Database.Schema.organization_invite_link.id }),
        )
        if (revoked.length === 0) return yield* linkNotFound
      }),
      preview: Effect.fn("OrganizationInviteLink.preview")(function* (token: string) {
        const now = yield* Clock.currentTimeMillis
        const row = (yield* database.transaction((transaction) =>
          transaction
            .select({
              id: Database.Schema.organization_invite_link.id,
              expiresAt: Database.Schema.organization_invite_link.expires_at,
              revokedAt: Database.Schema.organization_invite_link.revoked_at,
              organizationId: Database.Schema.organization.id,
              organizationName: Database.Schema.organization.name,
              organizationLogo: Database.Schema.organization.logo,
              creatorName: Database.Schema.user.name,
            })
            .from(Database.Schema.organization_invite_link)
            .innerJoin(
              Database.Schema.organization,
              eq(Database.Schema.organization.id, Database.Schema.organization_invite_link.organization_id),
            )
            .innerJoin(
              Database.Schema.user,
              eq(Database.Schema.user.id, Database.Schema.organization_invite_link.created_by),
            )
            .where(eq(Database.Schema.organization_invite_link.token, token)),
        )).at(0)
        if (!row)
          return {
            state: "invalid",
            organization: null,
            inviter: null,
            spaces: [],
          } satisfies OrganizationInviteLink.Preview
        let state: OrganizationInviteLink.State = "pending"
        if (row.expiresAt.getTime() <= now) state = "expired"
        if (row.revokedAt) state = "revoked"
        const spaces =
          state === "pending"
            ? (yield* database.transaction((transaction) =>
                infos(transaction, eq(Database.Schema.organization_invite_link.id, row.id)),
              )).flatMap((info) => info.spaces)
            : []
        return {
          state,
          organization: {
            id: Auth.OrganizationID.make(row.organizationId),
            name: row.organizationName,
            logo: row.organizationLogo,
          },
          inviter: row.creatorName.trim() ? { name: row.creatorName.trim() } : null,
          spaces,
        } satisfies OrganizationInviteLink.Preview
      }),
      accept: Effect.fn("OrganizationInviteLink.accept")(function* (
        userId: Auth.UserID,
        token: string,
        addMember: (organizationId: Auth.OrganizationID) => Effect.Effect<void>,
      ) {
        const now = new Date(yield* Clock.currentTimeMillis)
        const accepted = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const link = (yield* transaction
              .select({
                id: Database.Schema.organization_invite_link.id,
                organizationId: Database.Schema.organization_invite_link.organization_id,
                spaceIds: Database.Schema.organization_invite_link.space_ids,
              })
              .from(Database.Schema.organization_invite_link)
              .where(
                and(
                  eq(Database.Schema.organization_invite_link.token, token),
                  isNull(Database.Schema.organization_invite_link.revoked_at),
                  gt(Database.Schema.organization_invite_link.expires_at, now),
                ),
              )
              .for("update")).at(0)
            if (!link) return yield* linkNotFound
            const organizationId = Auth.OrganizationID.make(link.organizationId)
            const first = (yield* firstSpace(transaction, organizationId)).at(0)
            const spaces = yield* liveSpaces(transaction, link.spaceIds)
            const landing =
              spaces.find((space) => space.id !== first?.id) ?? spaces.find((space) => space.id === first?.id)
            if (!landing) return yield* linkNotFound
            const isMember = Boolean(yield* SpaceQueries.organizationMember(transaction, organizationId, userId))
            if (!isMember) yield* addMember(organizationId)
            const added = yield* SpaceQueries.admit(
              transaction,
              userId,
              spaces.map((space) => space.id),
            )
            if (!isMember || added.length > 0)
              yield* transaction
                .update(Database.Schema.organization_invite_link)
                .set({ uses: sql`${Database.Schema.organization_invite_link.uses} + 1` })
                .where(eq(Database.Schema.organization_invite_link.id, link.id))
            return {
              joined: { organizationId, spaceId: landing.id, slug: landing.slug },
              workloads: yield* CredentialOffboarding.spaceBrains(transaction, added),
            }
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
