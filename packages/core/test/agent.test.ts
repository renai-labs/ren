import { describe, expect } from "bun:test"
import { BrainProviders } from "./lib/brain-providers.js"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { ReferenceCheck } from "../src/reference-check.js"
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
    Layer.provideMerge(Layer.mergeAll(Space.layer.pipe(Layer.provide(BrainProviders.none)), SpaceMember.layer)),
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone, ReferenceCheck.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

const page = { page: 1, pageSize: 50 }

const empty = { permissions: [], references: [] }

const org = Effect.gen(function* () {
  const spaces = yield* Space.Service
  const members = yield* SpaceMember.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* Seed.actor(organizationId, "member")
  const grace = yield* Seed.actor(organizationId, "member")
  const admin = yield* Seed.actor(organizationId, "admin")
  const factory = yield* spaces.create(ada, { name: "Factory" })
  const eng = yield* spaces.create(grace, { name: "Eng" })
  return {
    organizationId,
    ada,
    grace,
    admin,
    factory,
    eng,
    join: (actor: typeof ada, spaceId: typeof factory.id) =>
      members.create(spaceId === factory.id ? ada : grace, { spaceId, userId: actor.userId }),
  }
})

const build = { name: "build", isSubagent: false, settings: { ...empty, instructions: "You build features." } }

describe("Agent", () => {
  for (const operation of ["create", "transfer"] as const)
    it.live(`${operation} cannot give an agent to a concurrently archived space`, () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const sql = yield* SqlClient.SqlClient
        const o = yield* org
        const existing = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
        yield* o.join(o.ada, o.eng.id)
        const locked = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const archive = yield* Effect.forkChild(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`update space set archived_at = now() where id = ${o.eng.id}`
              yield* Deferred.succeed(locked, undefined)
              yield* Deferred.await(release)
            }),
          ),
        )
        yield* Deferred.await(locked)
        const write = yield* Effect.forkChild(
          Effect.result(
            operation === "create"
              ? agents.create(o.ada, { ...build, name: "other", ownerSpaceId: o.eng.id })
              : agents.transferOwnership(o.ada, existing.id, { spaceId: o.eng.id }),
          ),
        )
        yield* sql<{ readonly waiting: number }>`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`.pipe(
          Effect.repeat({ until: (rows) => (rows.at(0)?.waiting ?? 0) > 0 || write.pollUnsafe() !== undefined }),
          Effect.ensuring(Deferred.succeed(release, undefined)),
        )
        yield* Fiber.join(archive)
        expect(yield* Fiber.join(write)).toMatchObject({ _tag: "Failure", failure: { _tag: "Primitive.NotFound" } })
      }),
    )

  it.live("a member of a space creates an agent it owns, and a non-member gets NotFound for the space", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      expect(created).toMatchObject({ name: "build", ownerSpaceId: o.factory.id, isSubagent: false, archivedAt: null })
      expect(yield* agents.get(o.ada, "build")).toEqual(created)
      const refused = yield* Effect.flip(
        agents.create(o.grace, { ...build, name: "other", ownerSpaceId: o.factory.id }),
      )
      expect(refused._tag).toBe("Primitive.NotFound")
      expect(refused.message).toBe("Space not found.")
    }),
  )

  it.live("a duplicate or reserved name in the org gets Conflict", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const o = yield* org
      yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      expect((yield* Effect.flip(agents.create(o.grace, { ...build, ownerSpaceId: o.eng.id })))._tag).toBe(
        "Primitive.Conflict",
      )
      for (const name of ["ren", "explore", "general", "title"])
        expect((yield* Effect.flip(agents.create(o.ada, { ...build, name, ownerSpaceId: o.factory.id })))._tag).toBe(
          "Primitive.Conflict",
        )
    }),
  )

  it.live("a user in none of the agent's spaces gets NotFound, an org admin too (AC4)", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      expect((yield* Effect.flip(agents.get(o.grace, created.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* agents.list(o.grace, page)).items).toEqual([])
      expect((yield* agents.list(o.admin, page)).items).toEqual([])
    }),
  )

  it.live("every member lists and gets the live global agents, in every space, but cannot change them", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const o = yield* org
      const ren = yield* Seed.globalAgent("ren", { isSubagent: false })
      yield* Seed.globalAgent("explore", { isSubagent: true })
      const own = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      const ids = (input: { readonly spaceId?: typeof o.factory.id }) =>
        agents
          .list(o.ada, { ...page, isSubagent: false, ...input })
          .pipe(Effect.map((result) => result.items.map((agent) => agent.id)))
      expect(yield* ids({})).toEqual([ren, own.id])
      expect(yield* ids({ spaceId: o.factory.id })).toEqual([ren, own.id])
      expect((yield* agents.list(o.grace, { ...page, isSubagent: false })).items.map((agent) => agent.id)).toEqual([
        ren,
      ])
      expect(yield* agents.get(o.grace, ren)).toMatchObject({
        name: "ren",
        organizationId: null,
        ownerSpaceId: null,
        canUpdate: false,
      })
      expect((yield* agents.get(o.grace, "ren")).id).toBe(ren)
      expect((yield* Effect.flip(agents.update(o.admin, ren, { description: "Mine" })))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(agents.archive(o.admin, ren)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("a member of a non-owner space can read the agent but gets Forbidden on edit", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      expect(created.canUpdate).toBe(true)
      yield* o.join(o.ada, o.eng.id)
      yield* memberships.create(o.ada, { agentId: created.id, spaceId: o.eng.id })
      expect(yield* agents.get(o.grace, created.id)).toMatchObject({ settings: build.settings, canUpdate: false })
      expect(
        (yield* agents.list(o.grace, { ...page, spaceId: o.eng.id })).items.map((agent) => [agent.id, agent.canUpdate]),
      ).toEqual([[created.id, false]])
      expect((yield* Effect.flip(agents.update(o.grace, created.id, { description: "Mine" })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* agents.update(o.ada, created.id, { description: "Builds" })).description).toBe("Builds")
    }),
  )

  it.live("an archive removes the agent's memberships", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const database = yield* Database.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      yield* o.join(o.ada, o.eng.id)
      yield* memberships.create(o.ada, { agentId: created.id, spaceId: o.eng.id })
      expect((yield* agents.archive(o.ada, created.id)).archivedAt).not.toBeNull()
      expect(
        yield* database.db
          .select()
          .from(Database.Schema.agent_membership)
          .where(eq(Database.Schema.agent_membership.agent_id, created.id)),
      ).toEqual([])
      expect((yield* Effect.flip(agents.get(o.ada, created.id)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("a move to a member space removes its row and gives the old owner a row", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      yield* o.join(o.ada, o.eng.id)
      yield* memberships.create(o.ada, { agentId: created.id, spaceId: o.eng.id })
      expect((yield* agents.transferOwnership(o.ada, created.id, { spaceId: o.eng.id })).ownerSpaceId).toBe(o.eng.id)
      const entries = (yield* memberships.list(o.ada, { ...page, agentId: created.id })).items
      expect(entries.map((entry) => ({ spaceId: entry.spaceId, isOwner: entry.isOwner }))).toEqual([
        { spaceId: o.eng.id, isOwner: true },
        { spaceId: o.factory.id, isOwner: false },
      ])
    }),
  )

  it.live("a move to a non-member space makes it owner and member", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      yield* o.join(o.ada, o.eng.id)
      yield* agents.transferOwnership(o.ada, created.id, { spaceId: o.eng.id })
      const entries = (yield* memberships.list(o.ada, { ...page, agentId: created.id })).items
      expect(entries.map((entry) => ({ spaceId: entry.spaceId, isOwner: entry.isOwner }))).toEqual([
        { spaceId: o.eng.id, isOwner: true },
        { spaceId: o.factory.id, isOwner: false },
      ])
    }),
  )

  it.live("a move needs membership in both spaces; an org admin outside them gets NotFound (AC4)", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const database = yield* Database.Service
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      yield* o.join(o.grace, o.factory.id)
      yield* memberships.create(o.grace, { agentId: created.id, spaceId: o.eng.id })
      const hidden = yield* Seed.space(o.organizationId)
      yield* database.db
        .update(Database.Schema.space)
        .set({ kind: "private", owner_user_id: o.grace.userId })
        .where(eq(Database.Schema.space.id, hidden))
      yield* Seed.join(hidden, o.grace.userId)
      expect((yield* Effect.flip(agents.transferOwnership(o.ada, created.id, { spaceId: hidden })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect(yield* Effect.flip(agents.transferOwnership(o.ada, created.id, { spaceId: o.eng.id }))).toMatchObject({
        _tag: "Primitive.Forbidden",
        message: "Moving an agent needs membership in both spaces.",
      })
      expect((yield* Effect.flip(agents.transferOwnership(o.admin, created.id, { spaceId: o.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* agents.transferOwnership(o.grace, created.id, { spaceId: o.eng.id })).ownerSpaceId).toBe(o.eng.id)
    }),
  )

  it.live("a subagent with references or without a description is refused", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const o = yield* org
      const references = [{ alias: "docs", repository: "https://github.com/acme/docs", description: "Product docs" }]
      const refused = yield* Effect.flip(
        agents.create(o.ada, {
          name: "explorer",
          description: "Explores the docs.",
          isSubagent: true,
          ownerSpaceId: o.factory.id,
          settings: { ...empty, references },
        }),
      )
      expect(refused._tag).toBe("Primitive.Conflict")
      const primary = yield* agents.create(o.ada, {
        ...build,
        ownerSpaceId: o.factory.id,
        settings: { ...empty, references },
      })
      expect(
        (yield* Effect.flip(agents.update(o.ada, primary.id, { isSubagent: true, description: "Builds." })))._tag,
      ).toBe("Primitive.Conflict")
      expect(
        yield* Effect.flip(
          agents.create(o.ada, {
            name: "helper",
            description: " ",
            isSubagent: true,
            ownerSpaceId: o.factory.id,
            settings: empty,
          }),
        ),
      ).toMatchObject({ _tag: "Primitive.Invalid", field: "description" })
      const plain = yield* agents.create(o.ada, { ...build, name: "plain", ownerSpaceId: o.factory.id })
      expect((yield* Effect.flip(agents.update(o.ada, plain.id, { isSubagent: true })))._tag).toBe("Primitive.Invalid")
      const helper = yield* agents.update(o.ada, plain.id, { isSubagent: true, description: "Helps." })
      expect(helper).toMatchObject({ isSubagent: true, description: "Helps." })
      expect((yield* Effect.flip(agents.update(o.ada, helper.id, { description: null })))._tag).toBe(
        "Primitive.Invalid",
      )
    }),
  )
})

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
  const bridge = yield* Seed.actor(organizationId, "member")
  yield* members.create(ada, { spaceId: factory.id, userId: bridge.userId })
  yield* members.create(grace, { spaceId: eng.id, userId: bridge.userId })
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
    bridge,
    factory,
    eng,
    agent,
    join: (userId: typeof ada.userId, spaceId: typeof factory.id) => members.create(bridge, { spaceId, userId }),
  }
})

describe("AgentMembership", () => {
  it.live("an add needs membership in both spaces; an org admin outside them gets NotFound (AC4)", () =>
    Effect.gen(function* () {
      const memberships = yield* AgentMembership.Service
      const s = yield* setup
      expect((yield* Effect.flip(memberships.create(s.ada, { agentId: s.agent.id, spaceId: s.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(memberships.create(s.grace, { agentId: s.agent.id, spaceId: s.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(memberships.create(s.admin, { agentId: s.agent.id, spaceId: s.eng.id })))._tag).toBe(
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
        yield* memberships.create(s.bridge, { agentId: s.agent.id, spaceId: s.eng.id })
        const review = yield* agents.create(s.grace, {
          name: "review",
          description: "Reviews changes.",
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
        const first = yield* memberships.list(s.bridge, { page: 1, pageSize: 2 })
        const second = yield* memberships.list(s.bridge, { page: 2, pageSize: 2 })
        expect([first.total, second.total]).toEqual([3, 3])
        expect([...of(first.items), ...of(second.items)]).toEqual(all)
        expect(of((yield* memberships.list(s.bridge, { ...page, spaceId: s.eng.id })).items)).toEqual(all.slice(1))
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
      const first = yield* memberships.create(s.bridge, { agentId: s.agent.id, spaceId: s.eng.id })
      expect(yield* memberships.create(s.bridge, { agentId: s.agent.id, spaceId: s.eng.id })).toEqual(first)
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

  it.live(
    "members of that space or of the owner space can remove, and others cannot, an org admin included (AC4)",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const memberships = yield* AgentMembership.Service
        const s = yield* setup
        const ops = yield* spaces.create(s.bridge, { name: "Ops" })
        const outsider = yield* Seed.actor(s.ada.organizationId, "member")
        yield* s.join(outsider.userId, ops.id)
        yield* s.join(s.grace.userId, ops.id)
        const added = () => memberships.create(s.bridge, { agentId: s.agent.id, spaceId: s.eng.id })
        expect((yield* Effect.flip(memberships.archive(outsider, (yield* added()).id)))._tag).toBe("Primitive.NotFound")
        yield* memberships.create(s.bridge, { agentId: s.agent.id, spaceId: ops.id })
        expect((yield* Effect.flip(memberships.archive(outsider, (yield* added()).id)))._tag).toBe(
          "Primitive.Forbidden",
        )
        expect((yield* Effect.flip(memberships.archive(s.admin, (yield* added()).id)))._tag).toBe("Primitive.NotFound")
        for (const actor of [s.grace, s.ada, s.bridge])
          expect((yield* memberships.archive(actor, (yield* added()).id)).spaceId).toBe(s.eng.id)
      }),
  )
})
