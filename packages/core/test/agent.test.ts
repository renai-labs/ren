import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SqlClient } from "effect/sql"
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
      expect(yield* agents.get(o.grace, ren)).toMatchObject({ name: "ren", organizationId: null, ownerSpaceId: null })
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
      yield* o.join(o.ada, o.eng.id)
      yield* memberships.create(o.ada, { agentId: created.id, spaceId: o.eng.id })
      expect((yield* agents.get(o.grace, created.id)).settings).toEqual(build.settings)
      expect((yield* agents.list(o.grace, { ...page, spaceId: o.eng.id })).items.map((agent) => agent.id)).toEqual([
        created.id,
      ])
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
      const o = yield* org
      const created = yield* agents.create(o.ada, { ...build, ownerSpaceId: o.factory.id })
      yield* o.join(o.grace, o.factory.id)
      yield* memberships.create(o.grace, { agentId: created.id, spaceId: o.eng.id })
      expect((yield* Effect.flip(agents.transferOwnership(o.ada, created.id, { spaceId: o.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(agents.transferOwnership(o.admin, created.id, { spaceId: o.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* agents.transferOwnership(o.grace, created.id, { spaceId: o.eng.id })).ownerSpaceId).toBe(o.eng.id)
    }),
  )

  it.live("a subagent agent with references is refused", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const o = yield* org
      const references = [{ alias: "docs", repository: "acme/docs" }]
      const refused = yield* Effect.flip(
        agents.create(o.ada, {
          name: "explorer",
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
      expect((yield* Effect.flip(agents.update(o.ada, primary.id, { isSubagent: true })))._tag).toBe(
        "Primitive.Conflict",
      )
    }),
  )
})
