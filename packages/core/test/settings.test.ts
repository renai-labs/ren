import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Agent as AgentSchema } from "@ren/schema/agent"
import { Session } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import type { Settings as SettingsSchema } from "@ren/schema/settings"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { Agent } from "../src/agent.js"
import { AgentMembership } from "../src/agent/membership.js"
import { Settings } from "../src/settings.js"
import { SettingsRows } from "../src/settings/rows.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(Settings.layer, Agent.layer, AgentMembership.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Space.layer, SpaceMember.layer)),
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

const layer = (settings: Partial<SettingsSchema.Info>): SettingsSchema.Info => ({
  permissions: [],
  references: [],
  ...settings,
})

const write = (owner: SettingsRows.Owner, settings: Partial<SettingsSchema.Info>) =>
  Effect.flatMap(Database.Service, (database) =>
    database.transaction((transaction) => SettingsRows.write(transaction, owner, layer(settings))),
  )

const global = (name: string, input: { readonly isSubagent: boolean }) =>
  Effect.gen(function* () {
    const id = yield* Seed.globalAgent(name, input)
    yield* write({ agent_id: id }, { instructions: `You are ${name}.` })
    return id
  })

const setup = Effect.gen(function* () {
  const spaces = yield* Space.Service
  const database = yield* Database.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* Seed.actor(organizationId, "member")
  const factory = yield* spaces.create(ada, { name: "Factory" })
  const elsewhere = yield* spaces.create(ada, { name: "Elsewhere" })
  const sessionId = yield* Seed.session({ organizationId, spaceId: factory.id, createdBy: ada.userId })
  yield* global("ren", { isSubagent: false })
  yield* global("general", { isSubagent: true })
  const explore = yield* global("explore", { isSubagent: true })
  const create = (
    name: string,
    input: { readonly isSubagent?: boolean; readonly ownerSpaceId?: typeof factory.id } = {},
  ) =>
    Effect.flatMap(Agent.Service, (agents) =>
      agents.create(ada, {
        name,
        isSubagent: input.isSubagent ?? false,
        ownerSpaceId: input.ownerSpaceId ?? factory.id,
        settings: layer({ instructions: `You are ${name}.` }),
      }),
    )
  const useAgent = (agentId: AgentSchema.ID) =>
    database.db
      .update(Database.Schema.agent_session)
      .set({ agent_id: agentId })
      .where(eq(Database.Schema.agent_session.id, sessionId))
  return { ada, organizationId, factory, elsewhere, sessionId, explore, create, useAgent }
})

const names = (layers: SessionSettings.Layers) =>
  layers.agents.map((agent) => `${agent.name}${agent.isSubagent ? " (subagent)" : ""}`)

describe("Settings.read", () => {
  it.live(
    "a session reads Ren, its org, its space, its agent, the space's subagents and Ren's subagents, each with a hash",
    () =>
      Effect.gen(function* () {
        const settings = yield* Settings.Service
        const s = yield* setup
        yield* write(SettingsRows.ren, {
          instructions: "House rules.",
          model: { endpointId: "stub", modelId: "stub-model" },
        })
        yield* write({ organization_id: s.organizationId }, { instructions: "Never print secrets." })
        yield* write({ space_id: s.factory.id }, { instructions: "We use Bun." })
        const build = yield* s.create("build")
        yield* s.create("reviewer", { isSubagent: true })
        yield* s.useAgent(build.id)
        const read = yield* settings.read(s.sessionId, {})
        expect(read.ren.settings).toEqual(
          layer({ instructions: "House rules.", model: { endpointId: "stub", modelId: "stub-model" } }),
        )
        expect(read.organization.settings).toEqual(layer({ instructions: "Never print secrets." }))
        expect(read.space.settings).toEqual(layer({ instructions: "We use Bun." }))
        expect(names(read)).toEqual(["build", "explore (subagent)", "general (subagent)", "reviewer (subagent)"])
        expect(read.agents.find((agent) => agent.name === "build")?.settings).toEqual(
          layer({ instructions: "You are build." }),
        )
        expect(read.agents.find((agent) => agent.name === "reviewer")?.settings).toEqual(
          layer({ instructions: "You are reviewer." }),
        )
        expect([read.ren, read.organization, read.space, ...read.agents].every((each) => Boolean(each.hash))).toBe(true)
      }),
  )

  it.live("a layer whose hash the brain already has comes back with its hash only", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      const s = yield* setup
      yield* write(SettingsRows.ren, { instructions: "House rules." })
      yield* write({ space_id: s.factory.id }, { instructions: "We use Bun." })
      yield* s.create("reviewer", { isSubagent: true })
      const first = yield* settings.read(s.sessionId, {})
      const known = {
        ren: first.ren.hash ?? "",
        space: first.space.hash ?? "",
        agents: Object.fromEntries(first.agents.map((agent) => [agent.name, agent.hash])),
      }
      const again = yield* settings.read(s.sessionId, known)
      expect(again.ren).toEqual({ hash: first.ren.hash })
      expect(again.space).toEqual({ hash: first.space.hash })
      expect(again.agents).toEqual(
        first.agents.map((agent) => ({
          name: agent.name,
          description: agent.description,
          isSubagent: agent.isSubagent,
          hash: agent.hash,
        })),
      )
      yield* write({ space_id: s.factory.id }, { instructions: "We use Bun 1.3." })
      const edited = yield* settings.read(s.sessionId, known)
      expect(edited.space.settings).toEqual(layer({ instructions: "We use Bun 1.3." }))
      expect(edited.space.hash).not.toBe(first.space.hash)
      expect(edited.ren).toEqual({ hash: first.ren.hash })
    }),
  )

  it.live("a session with no agent of its own runs as Ren's agent, and a layer with no row has no hash", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      const s = yield* setup
      const read = yield* settings.read(s.sessionId, {})
      expect([read.ren, read.organization, read.space]).toEqual([{ hash: null }, { hash: null }, { hash: null }])
      expect(names(read)).toEqual(["explore (subagent)", "general (subagent)", "ren"])
      expect(read.agents.find((agent) => agent.name === "ren")).toMatchObject({
        description: "The ren agent",
        settings: layer({ instructions: "You are ren." }),
      })
    }),
  )

  it.live("an edit of one of Ren's agents changes only that agent's hash", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      const s = yield* setup
      const hashes = Effect.map(settings.read(s.sessionId, {}), (read) =>
        Object.fromEntries(read.agents.map((agent) => [agent.name, agent.hash])),
      )
      const before = yield* hashes
      yield* write({ agent_id: s.explore }, { instructions: "You only search." })
      const after = yield* hashes
      expect(Object.keys(before).filter((name) => before[name] !== after[name])).toEqual(["explore"])
    }),
  )

  it.live(
    "an archived agent, a removed one and another session's primary agent are not listed, and a primary agent that became a subagent is listed as one",
    () =>
      Effect.gen(function* () {
        const settings = yield* Settings.Service
        const agents = yield* Agent.Service
        const memberships = yield* AgentMembership.Service
        const s = yield* setup
        const build = yield* s.create("build")
        yield* s.create("other")
        const archived = yield* s.create("archived", { isSubagent: true })
        const visiting = yield* s.create("visiting", { isSubagent: true, ownerSpaceId: s.elsewhere.id })
        const joined = yield* memberships.create(s.ada, { agentId: visiting.id, spaceId: s.factory.id })
        yield* agents.archive(s.ada, archived.id)
        yield* s.useAgent(build.id)
        expect(names(yield* settings.read(s.sessionId, {}))).toEqual([
          "build",
          "explore (subagent)",
          "general (subagent)",
          "visiting (subagent)",
        ])
        yield* memberships.archive(s.ada, joined.id)
        yield* agents.update(s.ada, build.id, { isSubagent: true })
        expect(names(yield* settings.read(s.sessionId, {}))).toEqual([
          "build (subagent)",
          "explore (subagent)",
          "general (subagent)",
          "ren",
        ])
      }),
  )

  it.live("an ownership move keeps an agent's hash, and an edit of its name, description or settings changes it", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const s = yield* setup
      const reviewer = yield* s.create("reviewer", { isSubagent: true })
      const hash = Effect.map(
        settings.read(s.sessionId, {}),
        (read) => read.agents.find((agent) => !["ren", "general", "explore"].includes(agent.name))?.hash,
      )
      const before = yield* hash
      yield* memberships.create(s.ada, { agentId: reviewer.id, spaceId: s.elsewhere.id })
      yield* agents.transferOwnership(s.ada, reviewer.id, { spaceId: s.elsewhere.id })
      expect(yield* hash).toBe(before)
      const seen = new Set([before])
      for (const input of [
        { name: "checker" },
        { description: "Checks work" },
        { settings: layer({ instructions: "You check." }) },
      ]) {
        yield* agents.update(s.ada, reviewer.id, input)
        const after = yield* hash
        expect(seen.has(after)).toBe(false)
        seen.add(after)
      }
    }),
  )

  it.live("an unknown session fails with NotFound", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      expect((yield* Effect.flip(settings.read(Session.ID.create(), {})))._tag).toBe("Settings.NotFound")
    }),
  )
})
