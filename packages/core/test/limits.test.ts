import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Signature } from "@ren/schema/signature"
import type { Session } from "@ren/schema/session"
import { eq } from "drizzle-orm"
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { Billing } from "../src/billing.js"
import { Limits } from "../src/limits.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"
import { TestInferencePlugin } from "./lib/inference-plugin.js"
import { ModelListsTest } from "./lib/model-lists.js"
import { Seed } from "./lib/seed.js"

const resetsAt = DateTime.makeUnsafe("2026-11-30T14:00:00.000Z")

const billing = Bun.serve({
  port: 0,
  fetch: () =>
    Response.json({
      plan: "pro",
      planStatus: "active",
      renewsAt: "2026-12-01T00:00:00.000Z",
      pendingPlan: null,
      availableMicroUsd: 500_000,
      grantedMicroUsd: 5_000_000,
    }),
})

const billingKey = await Effect.runPromise(Signature.generate("limits-billing-test"))

const it = testEffect(
  Layer.mergeAll(Billing.layerRenCloud, Access.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Signer.layerLocal, FetchHttpClient.layer)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          REN_BILLING_URL: `http://127.0.0.1:${billing.port}`,
          REN_BILLING_KEYS: JSON.stringify([
            {
              id: billingKey.privateKey.id,
              key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(billingKey.privateKey.key),
            },
          ]),
        }),
      ),
    ),
  ),
)

// oxlint-disable-next-line ren/no-comments -- Ren (paid by Ren, a free and a paid model) and Anthropic's seats (paid by the customer), as a gateway offers them.
const plugin = Effect.gen(function* () {
  const test = yield* TestInferencePlugin.make({
    providers: [
      TestInferencePlugin.provider("ren", { name: "Ren" }),
      TestInferencePlugin.provider("anthropic", { name: "Anthropic", payer: "customer", models: "organization" }),
    ],
  })
  yield* test.setModels("ren", {
    revision: "1",
    models: [
      { ...TestInferencePlugin.model("vendor/paid"), gateway: "ren/vendor/paid" },
      { ...TestInferencePlugin.model("vendor/free"), gateway: "ren/vendor/free", free: true },
    ],
  })
  yield* test.setModels("anthropic", {
    revision: "1",
    models: [{ ...TestInferencePlugin.model("claude-opus-5-5"), gateway: "seat/anthropic/claude-opus-5-5" }],
  })
  return test
})

const chat = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const sessionId = yield* Seed.session(owner)
  const now = Date.now()
  yield* database.db.insert(Database.Schema.opencode_session).values({
    session_id: sessionId,
    project_id: "project",
    slug: "chat",
    directory: "/workspace",
    version: "1",
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    time_created: now,
    time_updated: now,
  })
  const actor = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
  const use = (providerID: string, id: string) =>
    database.db
      .update(Database.Schema.opencode_session)
      .set({ model: JSON.stringify({ id, providerID }) })
      .where(eq(Database.Schema.opencode_session.session_id, sessionId))
      .pipe(Effect.orDie)
  const call = (root: Session.ID, minutesAgo: number, seat?: string) =>
    database.db.insert(Database.Schema.usage_event).values({
      source: "ren-inference",
      id: crypto.randomUUID(),
      type: "model.call",
      time: new Date(now - minutesAgo * 60_000),
      workload: "brain:brn_test",
      organization: owner.organizationId,
      space: owner.spaceId,
      root_session: root,
      payer: seat ? "customer" : "ren",
      provider: "anthropic",
      data: { requested_model: "m", served_model: "m", ...(seat ? { access: "seat", seat } : { access: "ren" }) },
    })
  return { owner, sessionId, actor, use, call }
})

const seatLimit = (id: string, connectedBy: string | undefined, percents: readonly [number, number]) => ({
  _tag: "seat" as const,
  id,
  label: "Claude subscription",
  plan: "Max",
  ...(connectedBy && { connectedBy }),
  windows: [
    { key: "5h", title: "5-hour limit", percent: percents[0], resetsAt },
    { key: "7d", title: "7-day limit", percent: percents[1], resetsAt },
    { key: "7d_opus", title: "Opus", percent: null, resetsAt: null },
  ],
})

// oxlint-disable-next-line ren/no-comments -- Runs `body` with Limits over the test inference plugin, which `body` drives.
const withPlugin = <A, E, R>(body: (test: Effect.Success<typeof plugin>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const test = yield* plugin
    return yield* body(test).pipe(
      Effect.provide(Limits.layer.pipe(Layer.provideMerge(ModelListsTest.layer(test.plugin)))),
    )
  })

const get = (actor: Parameters<Limits.Interface["get"]>[0], id: Session.ID) =>
  Limits.Service.use((limits) => limits.get(actor, id))

describe("Limits.get (Providers §9.3)", () => {
  it.live("a seat model shows the windows of the seat that served the chat’s last seat call", () =>
    withPlugin((test) =>
      Effect.gen(function* () {
        const found = yield* chat()
        const asha = yield* Seed.user({ name: "Asha" })
        yield* test.setLimits("anthropic", [
          seatLimit("seat_asha", asha.id, [12, 81]),
          seatLimit("seat_ben", undefined, [99, 99]),
        ])
        const other = yield* Seed.session(found.owner)
        yield* found.use("anthropic", "claude-opus-5-5")
        yield* found.call(found.sessionId, 30, "seat_ben")
        yield* found.call(found.sessionId, 20, "seat_asha")
        yield* found.call(found.sessionId, 10)
        yield* found.call(other, 1, "seat_ben")

        const window = (key: string, title: string, percent: number) => ({
          _tag: "seat" as const,
          key: `seat:seat_asha:${key}`,
          percent,
          resetsAt,
          seat: "Asha’s Max",
          providerName: "Anthropic",
          window: key,
          title,
        })
        expect(yield* get(found.actor, found.sessionId)).toEqual({
          limits: [window("5h", "5-hour limit", 12), window("7d", "7-day limit", 81)],
          credit: null,
        })
      }),
    ),
  )

  it.live("a paid Ren model shows the credit; a free one shows the free cap and no credit", () =>
    withPlugin((test) =>
      Effect.gen(function* () {
        const found = yield* chat()
        const tomorrow = DateTime.makeUnsafe("2026-11-26T00:00:00.000Z")
        yield* test.setLimits("ren", [{ _tag: "free", used: 76, limit: 100, resetsAt: tomorrow }])

        yield* found.use("ren", "vendor/paid")
        expect(yield* get(found.actor, found.sessionId)).toEqual({
          limits: [],
          credit: {
            _tag: "credit",
            key: "credit",
            percent: 90,
            resetsAt: DateTime.makeUnsafe("2026-12-01T00:00:00.000Z"),
            availableMicroUsd: 500_000,
          },
        })

        yield* found.use("ren", "vendor/free")
        expect(yield* get(found.actor, found.sessionId)).toEqual({
          limits: [{ _tag: "free", key: "free", percent: 76, resetsAt: tomorrow, used: 76, limit: 100 }],
          credit: null,
        })
      }),
    ),
  )

  it.live("a person outside the chat’s space cannot read it", () =>
    withPlugin(() =>
      Effect.gen(function* () {
        const found = yield* chat()
        const outsider = yield* Seed.actor(found.owner.organizationId, "member")
        const error = yield* get(outsider, found.sessionId).pipe(Effect.flip)
        expect(error._tag).toBe("Primitive.NotFound")
      }),
    ),
  )
})
