import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { Agent } from "../src/agent.js"
import { AgentMembership } from "../src/agent/membership.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(Agent.layer, AgentMembership.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Space.layer, SpaceMember.layer)),
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

const page = { page: 1, pageSize: 50 }

const setup = Effect.gen(function* () {
  const spaces = yield* Space.Service
  const members = yield* SpaceMember.Service
  const agents = yield* Agent.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* Seed.actor(organizationId, "member")
  const grace = yield* Seed.actor(organizationId, "member")
  const admin = yield* Seed.actor(organizationId, "admin")
  const factory = yield* spaces.create(ada, { name: "Factory" })
  const eng = yield* spaces.create(grace, { name: "Eng" })
  const agent = yield* agents.create(ada, {
    name: "build",
    isSubagent: false,
    ownerSpaceId: factory.id,
    settings: { permissions: [], references: [] },
  })
  return {
    ada,
    grace,
    admin,
    factory,
    eng,
    agent,
    join: (userId: typeof ada.userId, spaceId: typeof factory.id) => members.create(admin, { spaceId, userId }),
  }
})

describe("AgentMembership", () => {
  it.live("an add needs membership in both spaces, or an org admin", () =>
    Effect.gen(function* () {
      const memberships = yield* AgentMembership.Service
      const s = yield* setup
      expect((yield* Effect.flip(memberships.create(s.ada, { agentId: s.agent.id, spaceId: s.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(memberships.create(s.grace, { agentId: s.agent.id, spaceId: s.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      yield* s.join(s.ada.userId, s.eng.id)
      expect(yield* memberships.create(s.ada, { agentId: s.agent.id, spaceId: s.eng.id })).toMatchObject({
        spaceId: s.eng.id,
        isOwner: false,
      })
    }),
  )

  it.live(
    "the list pages owner entries and rows in the order they were made, filters by space and hides unseen agents",
    () =>
      Effect.gen(function* () {
        const memberships = yield* AgentMembership.Service
        const agents = yield* Agent.Service
        const s = yield* setup
        yield* memberships.create(s.admin, { agentId: s.agent.id, spaceId: s.eng.id })
        const review = yield* agents.create(s.grace, {
          name: "review",
          isSubagent: true,
          ownerSpaceId: s.eng.id,
          settings: { permissions: [], references: [] },
        })
        const of = (
          items: ReadonlyArray<{ readonly agentId: string; readonly spaceId: string; readonly isOwner: boolean }>,
        ) => items.map((item) => [item.agentId, item.spaceId, item.isOwner])
        const all = [
          [s.agent.id, s.factory.id, true],
          [s.agent.id, s.eng.id, false],
          [review.id, s.eng.id, true],
        ]
        const first = yield* memberships.list(s.admin, { page: 1, pageSize: 2 })
        const second = yield* memberships.list(s.admin, { page: 2, pageSize: 2 })
        expect([first.total, second.total]).toEqual([3, 3])
        expect([...of(first.items), ...of(second.items)]).toEqual(all)
        expect(of((yield* memberships.list(s.admin, { ...page, spaceId: s.eng.id })).items)).toEqual(all.slice(1))
        expect(of((yield* memberships.list(s.grace, page)).items)).toEqual(all)
        expect(yield* memberships.list(s.ada, page)).toMatchObject({ total: 2 })
        expect(of((yield* memberships.list(s.ada, page)).items)).toEqual(all.slice(0, 2))
      }),
  )

  it.live("an add to the owner space writes no row, and the list shows the owner space with isOwner", () =>
    Effect.gen(function* () {
      const memberships = yield* AgentMembership.Service
      const database = yield* Database.Service
      const s = yield* setup
      const owner = yield* memberships.create(s.ada, { agentId: s.agent.id, spaceId: s.factory.id })
      expect(owner).toMatchObject({ spaceId: s.factory.id, isOwner: true })
      expect(
        yield* database.db
          .select()
          .from(Database.Schema.agent_membership)
          .where(eq(Database.Schema.agent_membership.agent_id, s.agent.id)),
      ).toEqual([])
      expect((yield* memberships.list(s.ada, { ...page, spaceId: s.factory.id })).items).toEqual([owner])
    }),
  )

  it.live("a second add returns the existing membership", () =>
    Effect.gen(function* () {
      const memberships = yield* AgentMembership.Service
      const s = yield* setup
      const first = yield* memberships.create(s.admin, { agentId: s.agent.id, spaceId: s.eng.id })
      expect(yield* memberships.create(s.admin, { agentId: s.agent.id, spaceId: s.eng.id })).toEqual(first)
    }),
  )

  it.live("an attempt to remove the owner space gets Conflict", () =>
    Effect.gen(function* () {
      const memberships = yield* AgentMembership.Service
      const s = yield* setup
      const owner = (yield* memberships.list(s.ada, { ...page, agentId: s.agent.id })).items.at(0)
      expect(owner?.isOwner).toBe(true)
      if (!owner) return
      expect((yield* Effect.flip(memberships.archive(s.ada, owner.id)))._tag).toBe("Primitive.Conflict")
    }),
  )

  it.live("members of that space, of the owner space, or org admins can remove, and others cannot", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const memberships = yield* AgentMembership.Service
      const s = yield* setup
      const ops = yield* spaces.create(s.admin, { name: "Ops" })
      const outsider = yield* Seed.actor(s.ada.organizationId, "member")
      yield* s.join(outsider.userId, ops.id)
      yield* s.join(s.grace.userId, ops.id)
      const added = () => memberships.create(s.admin, { agentId: s.agent.id, spaceId: s.eng.id })
      expect((yield* Effect.flip(memberships.archive(outsider, (yield* added()).id)))._tag).toBe("Primitive.NotFound")
      yield* memberships.create(s.admin, { agentId: s.agent.id, spaceId: ops.id })
      expect((yield* Effect.flip(memberships.archive(outsider, (yield* added()).id)))._tag).toBe("Primitive.Forbidden")
      for (const actor of [s.grace, s.ada, s.admin])
        expect((yield* memberships.archive(actor, (yield* added()).id)).spaceId).toBe(s.eng.id)
    }),
  )
})
