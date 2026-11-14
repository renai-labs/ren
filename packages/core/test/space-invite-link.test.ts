import { describe, expect } from "bun:test"
import { BrainProviders } from "./lib/brain-providers.js"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { Space } from "../src/space.js"
import { SpaceInviteLink } from "../src/space/invite-link.js"
import { SpaceJoinRequest } from "../src/space/join-request.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(
    Space.layer.pipe(Layer.provide(BrainProviders.none)),
    SpaceMember.layer,
    SpaceInviteLink.layer,
    SpaceJoinRequest.layer,
    SpaceProvisioning.layer,
  ).pipe(Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)), Layer.provideMerge(Testing.layer)),
)

const person = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, "member")
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: ["member"] }
})

describe("SpaceInviteLink", () => {
  it.live("an organization member who opens the link joins the space, and each join counts one use", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* SpaceInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId)
      const grace = yield* person(organizationId)
      const design = yield* spaces.create(ada, { name: "Design" })
      const link = yield* links.get(ada, design.id)
      expect(link.uses).toBe(0)
      expect(yield* links.get(ada, design.id)).toEqual(link)
      expect(yield* links.preview(grace.userId, link.token)).toMatchObject({
        state: "joinable",
        space: { id: design.id, name: "Design" },
      })
      expect(yield* links.accept(grace.userId, link.token)).toEqual({
        organizationId,
        spaceId: design.id,
        slug: design.slug,
      })
      expect((yield* links.preview(grace.userId, link.token)).state).toBe("member")
      yield* links.accept(grace.userId, link.token)
      expect((yield* links.get(ada, design.id)).uses).toBe(1)
      expect((yield* spaces.get(grace, design.id)).membershipId).not.toBeNull()
    }),
  )

  it.live("joining through the link closes the person's pending request to join the space", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const requests = yield* SpaceJoinRequest.Service
      const links = yield* SpaceInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId)
      const grace = yield* person(organizationId)
      const design = yield* spaces.create(ada, { name: "Design" })
      const request = yield* requests.create(grace, { spaceId: design.id })
      yield* links.accept(grace.userId, (yield* links.get(ada, design.id)).token)
      expect((yield* requests.list(ada, { spaceId: design.id, page: 1, pageSize: 50 })).items).toMatchObject([
        { id: request.id, status: "cancelled" },
      ])
    }),
  )

  it.live("only members of a shared space read or reset its link", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* SpaceInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId)
      const grace = yield* person(organizationId)
      const design = yield* spaces.create(ada, { name: "Design" })
      const own = (yield* spaces.list(ada, { page: 1, pageSize: 50 })).items.find((space) => space.kind === "private")
      expect((yield* Effect.flip(links.get(grace, design.id)))._tag).toBe("Primitive.Forbidden")
      expect((yield* Effect.flip(links.reset(grace, design.id)))._tag).toBe("Primitive.Forbidden")
      expect((yield* Effect.flip(links.get(ada, own?.id ?? design.id)))._tag).toBe("Primitive.Forbidden")
    }),
  )

  it.live("someone outside the organization is refused and learns only the organization's name", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* SpaceInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId)
      const stranger = yield* person(yield* Seed.organization())
      const design = yield* spaces.create(ada, { name: "Design" })
      const link = yield* links.get(ada, design.id)
      expect(yield* links.preview(stranger.userId, link.token)).toEqual({
        state: "outside",
        organization: { id: organizationId, name: "Northstar" },
        space: null,
      })
      expect(yield* Effect.flip(links.accept(stranger.userId, link.token))).toMatchObject({
        _tag: "Primitive.Forbidden",
        message: "This link is for people in Northstar. Ask an admin to invite you.",
      })
      expect((yield* links.get(ada, design.id)).uses).toBe(0)
    }),
  )

  it.live("a reset stops the old link and starts a new one at zero uses", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* SpaceInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId)
      const grace = yield* person(organizationId)
      const design = yield* spaces.create(ada, { name: "Design" })
      const old = yield* links.get(ada, design.id)
      const fresh = yield* links.reset(ada, design.id)
      expect(fresh.token).not.toBe(old.token)
      expect(yield* links.get(ada, design.id)).toEqual(fresh)
      expect((yield* links.preview(grace.userId, old.token)).state).toBe("invalid")
      expect((yield* Effect.flip(links.accept(grace.userId, old.token)))._tag).toBe("Primitive.NotFound")
      expect((yield* links.accept(grace.userId, fresh.token)).spaceId).toBe(design.id)
    }),
  )

  it.live("archiving the space stops its link", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const links = yield* SpaceInviteLink.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* person(organizationId)
      const grace = yield* person(organizationId)
      const design = yield* spaces.create(ada, { name: "Design" })
      const link = yield* links.get(ada, design.id)
      yield* spaces.archive(ada, design.id)
      expect((yield* links.preview(grace.userId, link.token)).state).toBe("invalid")
      expect((yield* Effect.flip(links.accept(grace.userId, link.token)))._tag).toBe("Primitive.NotFound")
    }),
  )
})
