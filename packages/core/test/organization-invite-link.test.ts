import { describe, expect } from "bun:test"
import { BrainProviders } from "./lib/brain-providers.js"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { eq } from "drizzle-orm"
import { Effect, Layer, Ref } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { OrganizationInviteLink } from "../src/organization-invite-link.js"
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
    OrganizationInviteLink.layer,
    SpaceProvisioning.layer,
  ).pipe(Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)), Layer.provideMerge(Testing.layer)),
)

const person = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role: "owner" | "admin" | "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role] }
})

const stranger = Effect.fnUntraced(function* () {
  const seeded = yield* Seed.user()
  return seeded.id
})

const addAsMember = Effect.fnUntraced(function* (userId: Auth.UserID, added: Ref.Ref<number>) {
  const context = yield* Effect.context<Database.Service | SpaceProvisioning.Service>()
  return (organizationId: Auth.OrganizationID) =>
    Effect.gen(function* () {
      const provisioning = yield* SpaceProvisioning.Service
      yield* Seed.member(organizationId, userId, "member")
      yield* provisioning.createInitialMemberships(organizationId, { id: userId, name: "Newcomer", email: "n@x.dev" })
      yield* Ref.update(added, (count) => count + 1)
    }).pipe(Effect.orDie, Effect.provideContext(context))
})

const joinedSpaces = Effect.fnUntraced(function* (actor: {
  userId: Auth.UserID
  organizationId: Auth.OrganizationID
  roles: ReadonlyArray<string>
}) {
  const spaces = yield* Space.Service
  return (yield* spaces.list(actor, { page: 1, pageSize: 50 })).items
    .filter((space) => space.membershipId !== null && space.kind === "shared")
    .map((space) => space.name)
    .toSorted()
})

describe("OrganizationInviteLink", () => {
  it.live("an admin makes a link with the first space and the chosen spaces, and a member cannot", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* OrganizationInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId, "admin")
      const grace = yield* person(organizationId, "member")
      const design = yield* spaces.create(ada, { name: "Design" })
      const link = yield* links.create(ada, { spaceIds: [design.id], expiresIn: "7d" })
      expect(link.spaces.map((space) => space.name).toSorted()).toEqual(["Design", "General Space"])
      expect(link.token.startsWith("oil_")).toBe(true)
      expect((yield* links.list(ada)).map((each) => each.id)).toEqual([link.id])
      expect((yield* Effect.flip(links.create(grace, { spaceIds: [], expiresIn: "7d" })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* Effect.flip(links.list(grace)))._tag).toBe("Primitive.Forbidden")
      expect((yield* Effect.flip(links.revoke(grace, link.id)))._tag).toBe("Primitive.Forbidden")
    }),
  )

  it.live("a link lists only shared spaces the admin is in", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* OrganizationInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId, "admin")
      const grace = yield* person(organizationId, "admin")
      const secret = yield* spaces.create(grace, { name: "Secret" })
      const own = (yield* spaces.list(ada, { page: 1, pageSize: 50 })).items.find((space) => space.kind === "private")
      expect((yield* Effect.flip(links.create(ada, { spaceIds: [secret.id], expiresIn: "7d" })))._tag).toBe(
        "Primitive.Invalid",
      )
      expect((yield* Effect.flip(links.create(ada, { spaceIds: own ? [own.id] : [], expiresIn: "7d" })))._tag).toBe(
        "Primitive.Invalid",
      )
    }),
  )

  it.live(
    "someone outside the organization joins it with General and the link's spaces, and a person inside only gains spaces",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const links = yield* OrganizationInviteLink.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* person(organizationId, "owner")
        const grace = yield* person(organizationId, "member")
        const design = yield* spaces.create(ada, { name: "Design" })
        const link = yield* links.create(ada, { spaceIds: [design.id], expiresIn: "7d" })
        expect(yield* links.preview(link.token)).toMatchObject({
          state: "pending",
          organization: { id: organizationId, name: "Northstar" },
          inviter: { name: "Ada" },
        })
        const newcomer = yield* stranger()
        const added = yield* Ref.make(0)
        const joined = yield* links.accept(newcomer, link.token, yield* addAsMember(newcomer, added))
        expect(joined).toEqual({ organizationId, spaceId: design.id, slug: design.slug })
        expect(yield* joinedSpaces({ userId: newcomer, organizationId, roles: ["member"] })).toEqual([
          "Design",
          "General Space",
        ])
        expect(yield* links.accept(grace.userId, link.token, yield* addAsMember(grace.userId, added))).toMatchObject({
          spaceId: design.id,
        })
        expect(yield* joinedSpaces(grace)).toEqual(["Design", "General Space"])
        yield* links.accept(grace.userId, link.token, yield* addAsMember(grace.userId, added))
        expect(yield* Ref.get(added)).toBe(1)
        expect((yield* links.list(ada)).at(0)?.uses).toBe(2)
      }),
  )

  it.live("an expired link, a revoked link and an unknown link refuse everyone and add no one", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const links = yield* OrganizationInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId, "owner")
      const expired = yield* links.create(ada, { spaceIds: [], expiresIn: "1d" })
      const revoked = yield* links.create(ada, { spaceIds: [], expiresIn: "7d" })
      yield* database.db
        .update(Database.Schema.organization_invite_link)
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where(eq(Database.Schema.organization_invite_link.id, expired.id))
      yield* links.revoke(ada, revoked.id)
      expect((yield* links.preview(expired.token)).state).toBe("expired")
      expect((yield* links.preview(revoked.token)).state).toBe("revoked")
      expect(yield* links.preview("oil_unknown")).toMatchObject({ state: "invalid", organization: null })
      expect((yield* links.preview(expired.token)).spaces).toEqual([])
      expect(yield* links.list(ada)).toEqual([])
      const newcomer = yield* stranger()
      const added = yield* Ref.make(0)
      for (const token of [expired.token, revoked.token, "oil_unknown"]) {
        expect((yield* Effect.flip(links.accept(newcomer, token, yield* addAsMember(newcomer, added))))._tag).toBe(
          "Primitive.NotFound",
        )
      }
      expect(yield* Ref.get(added)).toBe(0)
      expect(
        yield* database.db
          .select({ id: Database.Schema.member.id })
          .from(Database.Schema.member)
          .where(eq(Database.Schema.member.userId, newcomer)),
      ).toEqual([])
      expect((yield* Effect.flip(links.revoke(ada, revoked.id)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("joining a space through the link closes the person's pending request to join it", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const requests = yield* SpaceJoinRequest.Service
      const links = yield* OrganizationInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId, "owner")
      const grace = yield* person(organizationId, "member")
      const design = yield* spaces.create(ada, { name: "Design" })
      const request = yield* requests.create(grace, { spaceId: design.id })
      const link = yield* links.create(ada, { spaceIds: [design.id], expiresIn: "7d" })
      yield* links.accept(grace.userId, link.token, () => Effect.void)
      expect((yield* requests.list(ada, { spaceId: design.id, page: 1, pageSize: 50 })).items).toMatchObject([
        { id: request.id, status: "cancelled" },
      ])
    }),
  )

  it.live("an archived space on the link is skipped", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* OrganizationInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId, "owner")
      const grace = yield* person(organizationId, "member")
      const design = yield* spaces.create(ada, { name: "Design" })
      const link = yield* links.create(ada, { spaceIds: [design.id], expiresIn: "7d" })
      yield* spaces.archive(ada, design.id)
      const joined = yield* links.accept(grace.userId, link.token, () => Effect.void)
      expect(joined.spaceId).not.toBe(design.id)
      expect((yield* links.preview(link.token)).spaces.map((space) => space.name)).toEqual(["General Space"])
    }),
  )
})
