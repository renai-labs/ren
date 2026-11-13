import { describe, expect } from "bun:test"
import { BrainProviders } from "./lib/brain-providers.js"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { and, eq, isNull } from "drizzle-orm"
import { Array, Effect, Layer, Option } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { Space } from "../src/space.js"
import { SpaceJoinRequest } from "../src/space/join-request.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(
    Space.layer.pipe(Layer.provide(BrainProviders.none)),
    SpaceMember.layer,
    SpaceJoinRequest.layer,
    SpaceProvisioning.layer,
  ).pipe(Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)), Layer.provideMerge(Testing.layer)),
)

const page = { page: 1, pageSize: 50 }

const user = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role] }
})

const setup = Effect.fnUntraced(function* () {
  const spaces = yield* Space.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* user(organizationId)
  const team = yield* spaces.create(ada, { name: "Team" })
  return { spaces, organizationId, ada, team }
})

const memberRows = Effect.fnUntraced(function* (spaceId: SpaceSchema.ID, userId: Auth.UserID) {
  const database = yield* Database.Service
  return yield* database.db
    .select({ id: Database.Schema.space_member.id })
    .from(Database.Schema.space_member)
    .where(
      and(
        eq(Database.Schema.space_member.space_id, spaceId),
        eq(Database.Schema.space_member.user_id, userId),
        isNull(Database.Schema.space_member.archived_at),
      ),
    )
})

describe("SpaceJoinRequest", () => {
  it.live("any role asks once for a shared space it is not in; a private space and a member are refused", () =>
    Effect.gen(function* () {
      const requests = yield* SpaceJoinRequest.Service
      const { spaces, organizationId, ada, team } = yield* setup()
      const grace = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const owner = yield* user(organizationId, "owner")
      yield* Effect.forEach([grace, admin, owner], (asker) =>
        Effect.gen(function* () {
          expect(yield* spaces.get(asker, team.id)).toMatchObject({ canRequestJoin: true, joinRequestId: null })
          const request = yield* requests.create(asker, { spaceId: team.id, note: "  Let me in  " })
          expect(request).toMatchObject({
            spaceId: team.id,
            userId: asker.userId,
            note: "Let me in",
            status: "pending",
            decidedBy: null,
            decidedAt: null,
          })
          expect(yield* spaces.get(asker, team.id)).toMatchObject({ canRequestJoin: false, joinRequestId: request.id })
          expect((yield* Effect.flip(requests.create(asker, { spaceId: team.id })))._tag).toBe("Primitive.Conflict")
        }),
      )
      expect(yield* spaces.get(ada, team.id)).toMatchObject({ canRequestJoin: false, joinRequestId: null })
      expect((yield* Effect.flip(requests.create(ada, { spaceId: team.id })))._tag).toBe("Primitive.Conflict")
      const personal = Option.getOrThrow(
        Array.findFirst((yield* spaces.list(ada, page)).items, (space) => space.kind === "private"),
      )
      expect(yield* spaces.get(grace, personal.id).pipe(Effect.flip)).toMatchObject({ _tag: "Primitive.NotFound" })
      expect((yield* Effect.flip(requests.create(grace, { spaceId: personal.id })))._tag).toBe("Primitive.NotFound")
      expect((yield* spaces.get(admin, personal.id)).canRequestJoin).toBe(false)
      expect((yield* Effect.flip(requests.create(admin, { spaceId: personal.id })))._tag).toBe("Primitive.Forbidden")
    }),
  )

  it.live("only members of the space list, approve and decline; the asker sees and cancels their own", () =>
    Effect.gen(function* () {
      const requests = yield* SpaceJoinRequest.Service
      const { organizationId, ada, team } = yield* setup()
      const grace = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const request = yield* requests.create(grace, { spaceId: team.id })
      expect((yield* requests.list(ada, { ...page, spaceId: team.id })).items.map((item) => item.id)).toEqual([
        request.id,
      ])
      expect((yield* requests.list(grace, { ...page, spaceId: team.id })).total).toBe(0)
      expect((yield* requests.list(admin, { ...page, spaceId: team.id })).total).toBe(0)
      expect((yield* requests.list(grace, page)).items.map((item) => item.id)).toEqual([request.id])
      expect((yield* requests.list(ada, page)).total).toBe(0)
      expect((yield* requests.list(ada, { ...page, spaceId: team.id, status: "approved" })).total).toBe(0)
      expect((yield* Effect.flip(requests.approve(grace, request.id, {})))._tag).toBe("Primitive.Forbidden")
      expect((yield* Effect.flip(requests.decline(grace, request.id, {})))._tag).toBe("Primitive.Forbidden")
      expect((yield* Effect.flip(requests.approve(admin, request.id, {})))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(requests.cancel(admin, request.id, {})))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(requests.cancel(ada, request.id, {})))._tag).toBe("Primitive.Forbidden")
      const cancelled = yield* requests.cancel(grace, request.id, {})
      expect(cancelled).toMatchObject({ status: "cancelled", decidedBy: grace.userId })
      expect((yield* Effect.flip(requests.cancel(grace, request.id, {})))._tag).toBe("Primitive.Conflict")
      expect((yield* Effect.flip(requests.approve(ada, request.id, {})))._tag).toBe("Primitive.Conflict")
    }),
  )

  it.live("approving adds the member and closes the request; a declined person can ask again", () =>
    Effect.gen(function* () {
      const requests = yield* SpaceJoinRequest.Service
      const { spaces, organizationId, ada, team } = yield* setup()
      const grace = yield* user(organizationId)
      const first = yield* requests.create(grace, { spaceId: team.id })
      expect(yield* requests.decline(ada, first.id, {})).toMatchObject({ status: "declined", decidedBy: ada.userId })
      expect(yield* memberRows(team.id, grace.userId)).toHaveLength(0)
      const second = yield* requests.create(grace, { spaceId: team.id })
      expect(second.id).not.toBe(first.id)
      expect(yield* requests.approve(ada, second.id, {})).toMatchObject({ status: "approved", decidedBy: ada.userId })
      expect(yield* memberRows(team.id, grace.userId)).toHaveLength(1)
      expect(yield* spaces.get(grace, team.id)).toMatchObject({ canRequestJoin: false, joinRequestId: null })
      expect((yield* spaces.list(grace, { ...page, joined: true })).items.map((space) => space.id)).toContain(team.id)
      expect((yield* spaces.get(ada, team.id)).memberCount).toBe(2)
      expect((yield* Effect.flip(requests.decline(ada, second.id, {})))._tag).toBe("Primitive.Conflict")
    }),
  )

  it.live("approving a person who is already a member closes the request without a second row", () =>
    Effect.gen(function* () {
      const requests = yield* SpaceJoinRequest.Service
      const { organizationId, ada, team } = yield* setup()
      const grace = yield* user(organizationId)
      const request = yield* requests.create(grace, { spaceId: team.id })
      yield* Seed.join(team.id, grace.userId)
      expect(yield* requests.approve(ada, request.id, {})).toMatchObject({ status: "approved" })
      expect(yield* memberRows(team.id, grace.userId)).toHaveLength(1)
    }),
  )

  it.live("a pending request closes when the person joins another way", () =>
    Effect.gen(function* () {
      const requests = yield* SpaceJoinRequest.Service
      const members = yield* SpaceMember.Service
      const { organizationId, ada, team } = yield* setup()
      const grace = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const added = yield* requests.create(grace, { spaceId: team.id })
      const joined = yield* requests.create(admin, { spaceId: team.id })
      yield* members.create(ada, { spaceId: team.id, userId: grace.userId })
      yield* members.create(admin, { spaceId: team.id, userId: admin.userId })
      const mine = (actor: typeof grace) => requests.list(actor, { ...page, status: "cancelled" })
      expect((yield* mine(grace)).items.map((item) => item.id)).toEqual([added.id])
      expect((yield* mine(admin)).items.map((item) => item.id)).toEqual([joined.id])
      expect((yield* requests.list(ada, { ...page, spaceId: team.id, status: "pending" })).total).toBe(0)
    }),
  )

  it.live("a pending request closes when its space is archived or the person leaves the organization", () =>
    Effect.gen(function* () {
      const requests = yield* SpaceJoinRequest.Service
      const provisioning = yield* SpaceProvisioning.Service
      const { spaces, organizationId, ada, team } = yield* setup()
      const other = yield* spaces.create(ada, { name: "Other" })
      const grace = yield* user(organizationId)
      const heidi = yield* user(organizationId)
      yield* requests.create(grace, { spaceId: team.id })
      yield* requests.create(grace, { spaceId: other.id })
      yield* requests.create(heidi, { spaceId: other.id })
      yield* spaces.archive(ada, team.id)
      expect((yield* requests.list(grace, { ...page, status: "pending" })).items.map((item) => item.spaceId)).toEqual([
        other.id,
      ])
      yield* provisioning.archiveMemberships(organizationId, grace.userId)
      expect((yield* requests.list(grace, { ...page, status: "pending" })).total).toBe(0)
      expect((yield* requests.list(heidi, { ...page, status: "pending" })).total).toBe(1)
      expect((yield* requests.list(ada, { ...page, spaceId: other.id, status: "pending" })).items).toHaveLength(1)
    }),
  )
})
