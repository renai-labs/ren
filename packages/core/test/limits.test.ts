import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Signature } from "@ren/schema/signature"
import type { Session } from "@ren/schema/session"
import type { Usage } from "@ren/schema/usage"
import { eq } from "drizzle-orm"
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { Billing } from "../src/billing.js"
import { Limits } from "../src/limits.js"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelLists } from "../src/model-lists.js"
import { RenInference } from "../src/ren-inference.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const resetsAt = "2026-11-30T14:00:00.000Z"

const seat = (
  id: string,
  connectedBy: string | null,
  percents: { readonly fiveHour: number; readonly week: number },
) => ({
  id,
  label: "Claude subscription",
  providerName: "Anthropic",
  providerId: "anthropic",
  iconUrl: "",
  status: { label: "Ready", tone: "ok" },
  plan: "Max",
  models: ["claude-opus-5-5"],
  canReconnect: false,
  meters: [
    { key: "5h", title: "5-hour limit", percent: percents.fiveHour, resetsAt },
    { key: "7d", title: "7-day limit", percent: percents.week, resetsAt },
    { key: "7d_opus", title: "Opus", percent: null },
  ],
  connectedBy,
})

const seats: Array<ReturnType<typeof seat>> = []

const gateway = Bun.serve({
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname
    if (path === "/v1/connections") return Response.json(seats)
    if (path === "/v1/usage/free") return Response.json({ used: 76, limit: 100, resetsAt: "2026-11-24T00:00:00.000Z" })
    return new Response(null, { status: 404 })
  },
})

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

const model = (id: string, price: NonNullable<ModelCatalog.Model["price"]>): ModelCatalog.Model => ({
  id,
  name: id,
  type: "chat",
  tools: true,
  deprecated: false,
  input: ["text"],
  price,
})

const catalog: ModelCatalog.Data = {
  providers: [
    {
      id: "upstream-test",
      name: "Upstream",
      models: [model("vendor/paid", { input: 1, output: 4 }), model("vendor/free", { input: 0, output: 0 })],
    },
    { id: "anthropic", name: "Anthropic", models: [model("claude-opus-5-5", { input: 5, output: 25 })] },
  ],
}

const inferenceKey = await Effect.runPromise(Signature.generate("limits-inference-test"))
const billingKey = await Effect.runPromise(Signature.generate("limits-billing-test"))
const keys = (key: typeof inferenceKey) =>
  JSON.stringify([
    { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
  ])

const it = testEffect(
  Limits.layer.pipe(
    Layer.provideMerge(ModelLists.layer),
    Layer.provideMerge(ModelCatalog.layerFixture(catalog)),
    Layer.provideMerge(Layer.mergeAll(RenInference.layer, Billing.layerRenCloud)),
    Layer.provideMerge(Layer.mergeAll(Signer.layerLocal, FetchHttpClient.layer, Access.layer)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          REN_INFERENCE_URL: `http://127.0.0.1:${gateway.port}`,
          REN_INFERENCE_KEYS: keys(inferenceKey),
          REN_BILLING_URL: `http://127.0.0.1:${billing.port}`,
          REN_BILLING_KEYS: keys(billingKey),
          REN_MODELS_UPSTREAM: "upstream-test",
        }),
      ),
    ),
  ),
)

const chat = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const sessionId = yield* Seed.session(owner)
  const asha = yield* Seed.user({ name: "Asha" })
  yield* database.db.insert(Database.Schema.organization_seat_models).values({
    organization_id: owner.organizationId,
    connection_id: "seat_asha",
    vendor: "anthropic",
    models: ["claude-opus-5-5"],
    plan: "Max",
  })
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
  const call = (
    root: Session.ID,
    minutesAgo: number,
    fields: { readonly access: Usage.Access; readonly seat?: string },
  ) =>
    database.db.insert(Database.Schema.usage_event).values({
      source: "ren-inference",
      id: crypto.randomUUID(),
      type: "model.call",
      time: new Date(now - minutesAgo * 60_000),
      workload: "brain:brn_test",
      organization: owner.organizationId,
      space: owner.spaceId,
      root_session: root,
      payer: fields.seat ? "customer" : "ren",
      provider: "anthropic",
      data: { requested_model: "m", served_model: "m", ...fields },
    })
  return { owner, sessionId, asha, actor, use, call }
})

describe("Limits.get", () => {
  it.live("a subscription model shows the windows of the seat that served the chat’s last seat call", () =>
    Effect.gen(function* () {
      const limits = yield* Limits.Service
      const found = yield* chat()
      const other = yield* Seed.session(found.owner)
      seats.length = 0
      seats.push(
        seat("seat_asha", found.asha.id, { fiveHour: 12, week: 81 }),
        seat("seat_ben", null, { fiveHour: 99, week: 99 }),
      )
      yield* found.use("anthropic", "claude-opus-5-5")
      yield* found.call(found.sessionId, 30, { access: "seat", seat: "seat_ben" })
      yield* found.call(found.sessionId, 20, { access: "seat", seat: "seat_asha" })
      yield* found.call(found.sessionId, 10, { access: "ren" })
      yield* found.call(other, 1, { access: "seat", seat: "seat_ben" })

      const reset = DateTime.makeUnsafe(resetsAt)
      expect(yield* limits.get(found.actor, found.sessionId)).toEqual({
        meters: [
          {
            _tag: "seat",
            key: "seat:seat_asha:5h",
            percent: 12,
            resetsAt: reset,
            seat: "Asha’s Max",
            providerName: "Anthropic",
            window: "5h",
            title: "5-hour limit",
          },
          {
            _tag: "seat",
            key: "seat:seat_asha:7d",
            percent: 81,
            resetsAt: reset,
            seat: "Asha’s Max",
            providerName: "Anthropic",
            window: "7d",
            title: "7-day limit",
          },
        ],
      })
    }),
  )

  it.live("a Ren model shows the credit, a free Ren model the free cap", () =>
    Effect.gen(function* () {
      const limits = yield* Limits.Service
      const found = yield* chat()

      yield* found.use("ren", "vendor/paid")
      expect(yield* limits.get(found.actor, found.sessionId)).toEqual({
        meters: [
          {
            _tag: "credit",
            key: "credit",
            percent: 90,
            resetsAt: DateTime.makeUnsafe("2026-12-01T00:00:00.000Z"),
            availableMicroUsd: 500_000,
          },
        ],
      })

      yield* found.use("ren", "vendor/free")
      expect(yield* limits.get(found.actor, found.sessionId)).toEqual({
        meters: [
          {
            _tag: "free",
            key: "free",
            percent: 76,
            resetsAt: DateTime.makeUnsafe("2026-11-24T00:00:00.000Z"),
            used: 76,
            limit: 100,
          },
        ],
      })
    }),
  )

  it.live("a person outside the chat’s space cannot read it", () =>
    Effect.gen(function* () {
      const limits = yield* Limits.Service
      const found = yield* chat()
      const outsider = yield* Seed.actor(found.owner.organizationId, "member")
      const error = yield* limits.get(outsider, found.sessionId).pipe(Effect.flip)
      expect(error._tag).toBe("Primitive.NotFound")
    }),
  )
})
