import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { Space } from "@ren/schema/space"
import { asc, eq } from "drizzle-orm"
import { DateTime, Deferred, Effect, Fiber, Layer, Schedule } from "effect"
import { SqlClient } from "effect/sql"
import { Usage } from "../src/usage.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Usage.layer.pipe(Layer.provideMerge(Testing.layer)))

type ModelCallEvent = Extract<Usage.Event, { readonly type: "model.call" }>

const owner = Effect.map(Seed.owner(), (found) => ({ ...found, brainId: Brain.ID.create() }))

const event = Effect.fnUntraced(function* (
  found: {
    readonly organizationId: Usage.Event["organization"]
    readonly brainId: Brain.ID
    readonly spaceId: Space.ID
  },
  fields: Partial<ModelCallEvent> & Pick<ModelCallEvent, "id">,
) {
  return {
    source: "ren-inference",
    type: "model.call",
    time: yield* DateTime.now,
    workload: `brain:${found.brainId}`,
    organization: found.organizationId,
    brain: found.brainId,
    space: found.spaceId,
    payer: "ren",
    provider: "anthropic",
    cost_micro_usd: 31400,
    data: {
      requested_model: "claude-sonnet-4-5",
      served_model: "anthropic/claude-sonnet-4-5",
      kind: "primary",
      input_tokens: 2140,
      output_tokens: 512,
    },
    ...fields,
  } satisfies ModelCallEvent
})

const stored = Effect.flatMap(Database.Service, (database) =>
  database.db
    .select()
    .from(Database.Schema.usage_event)
    .orderBy(asc(Database.Schema.usage_event.id))
    .pipe(Effect.orDie),
)

it.live("stores what the producer sent, claims included, and a batch sent two times once", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const found = yield* owner
    const batch = [
      yield* event(found, {
        id: "call-1:sonnet",
        root_session: "not a session",
        member: Models.personPlaceholder(found.memberId),
        agent: "analyst",
      }),
    ]
    expect(yield* usage.record(batch)).toEqual({ inserted: 1 })
    expect(yield* usage.record(batch)).toEqual({ inserted: 0 })
    expect(yield* stored).toMatchObject([
      {
        id: "call-1:sonnet",
        organization: found.organizationId,
        brain: found.brainId,
        space: found.spaceId,
        root_session: "not a session",
        member: Models.personPlaceholder(found.memberId),
        agent: "analyst",
        cost_micro_usd: 31400,
        data: {
          requested_model: "claude-sonnet-4-5",
          served_model: "anthropic/claude-sonnet-4-5",
          kind: "primary",
          input_tokens: 2140,
          output_tokens: 512,
        },
      },
    ])
  }),
)

it.live("Postgres refuses an update of a stored event", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const database = yield* Database.Service
    const found = yield* owner
    yield* usage.record([yield* event(found, { id: "call-1" })])
    const update = yield* database.db
      .update(Database.Schema.usage_event)
      .set({ cost_micro_usd: 0 })
      .where(eq(Database.Schema.usage_event.id, "call-1"))
      .pipe(Effect.flip)
    expect(String(update.cause)).toContain("usage_event is append only")
    expect(yield* stored).toMatchObject([{ cost_micro_usd: 31400 }])
  }),
)

it.live("a usage save waits for the one in progress and numbers its rows after it", () =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service
    const sql = yield* SqlClient.SqlClient
    const found = yield* owner
    const first = yield* event(found, { id: "call-1" })
    const second = yield* event(found, { id: "call-2" })
    const saved = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const slow = yield* Effect.forkChild(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* usage.record([first])
          yield* Deferred.succeed(saved, undefined)
          yield* Deferred.await(release)
        }),
      ),
    )
    yield* Deferred.await(saved)
    const fast = yield* Effect.forkChild(usage.record([second]))
    const waiting = yield* sql<{ readonly waiting: number }>`select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`.pipe(
      Effect.repeat({
        until: (rows) => (rows.at(0)?.waiting ?? 0) > 0 || fast.pollUnsafe() !== undefined,
        schedule: Schedule.spaced("10 millis"),
      }),
      Effect.ensuring(Deferred.succeed(release, undefined)),
    )
    expect(waiting.at(0)?.waiting).toBe(1)
    yield* Fiber.join(slow)
    yield* Fiber.join(fast)
    const rows = yield* stored
    expect(rows.map((row) => row.id)).toEqual(["call-1", "call-2"])
    expect(rows.map((row) => row.position).toSorted((a, b) => a - b)).toEqual(rows.map((row) => row.position))
  }),
)
