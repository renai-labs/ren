import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { asc } from "drizzle-orm"
import { DateTime, Duration, Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { Models } from "@ren/schema/models"
import { Usage } from "../src/usage.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Usage.layer.pipe(Layer.provide(Access.layer), Layer.provideMerge(Testing.layer)))

const chat = Effect.fnUntraced(function* () {
  const owner = yield* Seed.owner()
  const brainId = Brain.ID.create()
  const root = yield* Seed.session({ ...owner, brainId })
  const agentId = yield* Seed.agent(owner, "analyst", { isSubagent: false })
  return { ...owner, brainId, root, agentId }
})

const event = Effect.fnUntraced(function* (fields: Partial<Usage.Event> & Pick<Usage.Event, "id" | "workload">) {
  return {
    source: "ren-inference",
    type: "model.call",
    time: yield* DateTime.now,
    requested_model: "claude-sonnet-4-5",
    payer: "ren",
    provider: "anthropic",
    served_model: "anthropic/claude-sonnet-4-5",
    input_tokens: 2140,
    output_tokens: 512,
    cost_micro_usd: 31400,
    ...fields,
  } satisfies Usage.Event
})

const rows = Effect.flatMap(Database.Service, (database) =>
  database.db
    .select()
    .from(Database.Schema.usage_event)
    .orderBy(asc(Database.Schema.usage_event.id))
    .pipe(Effect.orDie),
)

it.live(
  "stamps the scope of the workload, keeps the claims that match it, and stores a batch sent two times once",
  () =>
    Effect.gen(function* () {
      const usage = yield* Usage.Service
      const found = yield* chat()
      const child = Session.ID.create()
      const claims = {
        workload: `brain:${found.brainId}`,
        root_session: found.root,
        turn: "msg_01",
        member: found.memberId,
      }
      const batch = [
        yield* event({ id: "call-1:sonnet", ...claims, session: found.root, agent: "analyst", kind: "primary" }),
        yield* event({ id: "call-2:haiku", ...claims, session: child, agent: "explore", variant: "high" }),
      ]
      expect(yield* usage.record("ren-inference", batch)).toEqual({ inserted: 2 })
      expect(yield* usage.record("ren-inference", batch)).toEqual({ inserted: 0 })
      expect(yield* rows).toMatchObject([
        {
          id: "call-1:sonnet",
          organization: found.organizationId,
          space: found.spaceId,
          brain: found.brainId,
          root_session: found.root,
          session: found.root,
          turn: "msg_01",
          member: found.memberId,
          agent: found.agentId,
          agent_name: null,
          kind: "primary",
          input_tokens: 2140,
          reasoning_tokens: 0,
          cost_micro_usd: 31400,
        },
        { id: "call-2:haiku", session: child, agent: null, agent_name: "explore", variant: "high" },
      ])
    }),
)

it.live("a member named by its placeholder, as when no egress replaced it, is checked the same way", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    yield* usage.record("ren-inference", [
      yield* event({
        id: "call-1",
        workload: `brain:${found.brainId}`,
        member: Models.personPlaceholder(found.memberId),
      }),
    ])
    expect(yield* rows).toMatchObject([{ member: found.memberId }])
  }),
)

it.live("a batch with one event that is not valid stores no row", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    const workload = `brain:${found.brainId}`
    const old = DateTime.subtractDuration(yield* DateTime.now, Duration.days(31))
    const error = yield* usage
      .record("ren-inference", [
        yield* event({ id: "new", workload }),
        yield* event({ id: "old", workload, time: old }),
      ])
      .pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "Usage.Invalid", message: "old: time is out of range" })
    expect(yield* rows).toEqual([])
  }),
)

it.live(
  "claims about another brain or another organization, and a kind that Ren does not know, are removed; the cost stays on the workload's scope",
  () =>
    Effect.gen(function* () {
      const usage = yield* Usage.Service
      const found = yield* chat()
      const other = yield* chat()
      yield* usage.record("ren-inference", [
        yield* event({
          id: "call-1",
          workload: `brain:${found.brainId}:3`,
          root_session: other.root,
          session: other.root,
          turn: "msg_01",
          member: other.memberId,
          agent: "analyst",
          kind: "summary",
        }),
      ])
      expect(yield* rows).toMatchObject([
        {
          organization: found.organizationId,
          space: found.spaceId,
          root_session: null,
          session: null,
          turn: null,
          member: null,
          agent: null,
          agent_name: "analyst",
          kind: null,
        },
      ])
    }),
)

it.live("an agent name that the space cannot use keeps only agent_name", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    const other = yield* chat()
    yield* Seed.agent(other, "researcher", { isSubagent: true })
    yield* usage.record("ren-inference", [
      yield* event({ id: "call-1", workload: `brain:${found.brainId}`, root_session: found.root, agent: "researcher" }),
    ])
    expect(yield* rows).toMatchObject([{ root_session: found.root, agent: null, agent_name: "researcher" }])
  }),
)

it.live("a hand's event gets the organization and space of its environment's brain", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    yield* usage.record("ren-inference", [
      yield* event({ id: "call-1", workload: `hand:env_${found.brainId.slice(4)}:1` }),
    ])
    expect(yield* rows).toMatchObject([
      { organization: found.organizationId, space: found.spaceId, brain: found.brainId },
    ])
  }),
)
