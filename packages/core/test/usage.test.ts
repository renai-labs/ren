import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { Space } from "@ren/schema/space"
import { asc, eq } from "drizzle-orm"
import { DateTime, Effect, Layer } from "effect"
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
