import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { asc, eq } from "drizzle-orm"
import { DateTime, Duration, Effect, Layer } from "effect"
import { Access } from "../src/access.js"
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

const event = Effect.fnUntraced(function* (
  found: {
    readonly organizationId: Usage.Event["organization"]
    readonly brainId: Brain.ID
    readonly spaceId: Space.ID
  },
  fields: Partial<Usage.Event> & Pick<Usage.Event, "id">,
) {
  return {
    source: "ren-inference",
    type: "model.call",
    time: yield* DateTime.now,
    workload: `brain:${found.brainId}`,
    organization: found.organizationId,
    brain: found.brainId,
    space: found.spaceId,
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

const stored = Effect.flatMap(Database.Service, (database) =>
  database.db
    .select()
    .from(Database.Schema.usage_event)
    .orderBy(asc(Database.Schema.usage_event.id))
    .pipe(Effect.orDie),
)

const attributed = Effect.flatMap(Database.Service, (database) =>
  database.db
    .select()
    .from(Database.Schema.usage_attribution)
    .orderBy(asc(Database.Schema.usage_attribution.id))
    .pipe(Effect.orDie),
)

it.live("stores what the producer sent, claims included, and a batch sent two times once", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    const batch = [
      yield* event(found, {
        id: "call-1:sonnet",
        root_session: "not a session",
        member: Models.personPlaceholder(found.memberId),
        agent: "analyst",
        kind: "summary",
      }),
    ]
    expect(yield* usage.record("ren-inference", batch)).toEqual({ inserted: 1 })
    expect(yield* usage.record("ren-inference", batch)).toEqual({ inserted: 0 })
    expect(yield* stored).toMatchObject([
      {
        id: "call-1:sonnet",
        organization: found.organizationId,
        brain: found.brainId,
        space: found.spaceId,
        root_session: "not a session",
        member: Models.personPlaceholder(found.memberId),
        agent_name: "analyst",
        kind: "summary",
        input_tokens: 2140,
        reasoning_tokens: 0,
        cost_micro_usd: 31400,
      },
    ])
  }),
)

it.live("reconciliation keeps the claims that agree with the brain's rows", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    const child = Session.ID.create()
    const claims = { root_session: found.root, turn: "msg_01", member: Models.personPlaceholder(found.memberId) }
    yield* usage.record("ren-inference", [
      yield* event(found, { id: "call-1", ...claims, session: found.root, agent: "analyst", kind: "primary" }),
      yield* event(found, { id: "call-2", ...claims, session: child, agent: "explore", kind: "primary" }),
    ])
    expect(yield* usage.reconcile).toBe(2)
    expect(yield* usage.reconcile).toBe(0)
    expect(yield* attributed).toMatchObject([
      {
        id: "call-1",
        space: found.spaceId,
        root_session: found.root,
        session: found.root,
        turn: "msg_01",
        member: found.memberId,
        agent: found.agentId,
        kind: "primary",
        problems: [],
      },
      { id: "call-2", session: child, member: found.memberId, agent: null, problems: [] },
    ])
  }),
)

it.live("reconciliation sets claims about another brain, organization or space to null", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    const other = yield* chat()
    yield* Seed.agent(other, "researcher", { isSubagent: false })
    yield* usage.record("ren-inference", [
      yield* event(found, {
        id: "call-1",
        root_session: other.root,
        session: other.root,
        turn: "msg_01",
        member: other.memberId,
        agent: "analyst",
      }),
      yield* event(found, { id: "call-2", root_session: found.root, agent: "researcher" }),
    ])
    yield* usage.reconcile
    expect(yield* attributed).toMatchObject([
      { id: "call-1", space: found.spaceId, root_session: null, session: null, turn: null, member: null, agent: null },
      { id: "call-2", root_session: found.root, agent: null },
    ])
  }),
)

it.live("reconciliation flags an organization that is not the brain's, a deleted brain and a time out of range", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* chat()
    const other = yield* chat()
    const gone = { ...found, brainId: Brain.ID.create() }
    yield* usage.record("ren-inference", [
      yield* event({ ...found, organizationId: other.organizationId }, { id: "call-1", root_session: found.root }),
      yield* event(gone, { id: "call-2" }),
      yield* event(found, { id: "call-3", time: DateTime.subtractDuration(yield* DateTime.now, Duration.days(31)) }),
    ])
    yield* usage.reconcile
    expect(yield* attributed).toMatchObject([
      { id: "call-1", space: null, root_session: null, problems: ["organization_mismatch"] },
      { id: "call-2", space: found.spaceId, problems: ["unknown_brain"] },
      { id: "call-3", space: found.spaceId, problems: ["time_out_of_range"] },
    ])
  }),
)

it.live("Postgres refuses an update of a stored event", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const database = yield* Database.Service
    const found = yield* chat()
    yield* usage.record("ren-inference", [yield* event(found, { id: "call-1" })])
    const update = yield* database.db
      .update(Database.Schema.usage_event)
      .set({ cost_micro_usd: 0 })
      .where(eq(Database.Schema.usage_event.id, "call-1"))
      .pipe(Effect.flip)
    expect(String(update.cause)).toContain("usage_event is append only")
    expect(yield* stored).toMatchObject([{ cost_micro_usd: 31400 }])
  }),
)
