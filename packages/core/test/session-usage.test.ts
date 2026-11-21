import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Session } from "../src/session.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Configured.sessionLayer)

const event = Effect.fnUntraced(function* (
  owner: Effect.Success<ReturnType<typeof Seed.owner>>,
  rootSession: string,
  fields: Partial<typeof Database.Schema.usage_event.$inferInsert>,
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.usage_event).values({
    source: "ren-inference",
    id: crypto.randomUUID(),
    type: "model.call",
    time: new Date(),
    workload: "brain:brn_test",
    organization: owner.organizationId,
    space: owner.spaceId,
    root_session: rootSession,
    payer: "ren",
    provider: "anthropic",
    cost_micro_usd: 1000,
    data: { requested_model: "m", served_model: "m" },
    ...fields,
  })
})

describe("Session usage", () => {
  it.live("sums Ren-paid model and tool events of the chat and its subagents", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const id = yield* Seed.session(owner)
      const other = yield* Seed.session(owner)
      const child = Session.ID.create()
      const parent = (yield* database.db
        .select()
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, id))).at(0)
      if (!parent) return yield* Effect.die(new Error("seeded chat is missing"))
      yield* database.db.insert(Database.Schema.agent_session).values({ ...parent, id: child, parent_id: id })
      const actor = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner" as const] }

      expect(yield* sessions.usage(actor, id)).toEqual({
        total: 0,
        models: 0,
        tools: 0,
        currency: "usd",
        source: "provider",
      })

      yield* event(owner, id, { cost_micro_usd: 4000 })
      yield* event(owner, id, { session: child, cost_micro_usd: 2500 })
      yield* event(owner, id, {
        type: "sandbox.compute",
        cost_micro_usd: 300,
        data: { sandbox_id: "sbx", duration_ms: 1, vcpu_ms: 1, memory_mib_ms: 1 },
      })
      yield* event(owner, id, { type: "api.call", cost_micro_usd: 100, data: { mcp: "exa" } })
      yield* event(owner, id, { type: "api.call", cost_micro_usd: null, data: { mcp: "exa" } })
      yield* event(owner, id, { payer: "customer", cost_micro_usd: 9000 })
      yield* event(owner, other, { cost_micro_usd: 7000 })

      const expected = {
        total: 6600,
        models: 6500,
        tools: 100,
        currency: "usd" as const,
        source: "provider" as const,
      }
      expect(yield* sessions.usage(actor, id)).toEqual(expected)
      expect(yield* sessions.usage(actor, child)).toEqual(expected)
    }),
  )

  it.live("hides the cost from a person who cannot read the chat", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const owner = yield* Seed.owner()
      const id = yield* Seed.session(owner)
      const stranger = yield* Seed.owner()
      const error = yield* sessions
        .usage({ userId: stranger.createdBy, organizationId: stranger.organizationId, roles: ["owner"] }, id)
        .pipe(Effect.flip)
      expect(error._tag).toBe("Primitive.NotFound")
    }),
  )
})
