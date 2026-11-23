import { describe, expect } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { Testing } from "@ren/db/testing"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Logger, Option, Queue, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import type { SqlError } from "effect/sql/SqlError"
import { Access } from "../src/access.js"
import { BrainPush } from "../src/brain-push.js"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelLists } from "../src/model-lists.js"
import { ProviderSettings } from "../src/provider-settings.js"
import { RenInference } from "../src/ren-inference.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const secret = "sk-test-own-key-never-stored-9f2c"

type Seen = { method: string; path: string; body: unknown }
const seen: Seen[] = []
const seats: Array<{ id: string; providerId: string; plan: string | null; models: string[] }> = []

const decodeFields = Schema.decodeUnknownOption(
  Schema.Struct({ fields: Schema.Record(Schema.String, Schema.String), model: Schema.String }),
)

const Told = Schema.Struct({
  switches: Schema.Array(Schema.Struct({ organizationId: Schema.String, off: Schema.Array(Schema.String) })),
})

type Answer = (fields: Record<string, string> | undefined) => Response

const answers = {
  test: (fields) =>
    Response.json(fields?.apiKey === secret ? { ok: true } : { ok: false, message: "Incorrect API key provided." }),
  key: (fields) =>
    fields?.apiKey === secret
      ? Response.json({ last4: secret.slice(-4), testedAt: new Date(Date.now()).toISOString() })
      : Response.json({ error: "Incorrect API key provided." }, { status: 400 }),
  connections: () =>
    Response.json(
      seats.map((seat) => ({
        ...seat,
        label: "Seat",
        providerName: "Anthropic",
        iconUrl: "",
        status: { label: "Ready", tone: "ok" },
        canReconnect: true,
        meters: [],
        connectedBy: null,
      })),
    ),
  free: () => Response.json({ used: 41, limit: 100, resetsAt: "2026-11-24T00:00:00.000Z" }),
} satisfies Record<string, Answer>

const answerOf = (method: string, path: string): Answer => {
  if (path.endsWith("/test")) return answers.test
  if (path.endsWith("/key") && method === "PUT") return answers.key
  if (path === "/v1/connections") return answers.connections
  if (path === "/v1/usage/free") return answers.free
  return () => new Response(null, { status: 204 })
}

const gateway = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    const body: unknown = request.method === "GET" || request.method === "DELETE" ? null : await request.json()
    seen.push({ method: request.method, path, body })
    return answerOf(request.method, path)(Option.getOrUndefined(decodeFields(body))?.fields)
  },
})

const model = (id: string, fields: Partial<ModelCatalog.Model> = {}): ModelCatalog.Model => ({
  id,
  name: id,
  type: "chat",
  tools: true,
  deprecated: false,
  input: ["text"],
  price: { input: 1, output: 4 },
  ...fields,
})

const catalog: ModelCatalog.Data = {
  providers: [
    { id: "upstream-test", name: "Upstream", models: [model("vendor/one"), model("vendor/two")] },
    { id: "groq", name: "Groq", models: [model("llama-5"), model("old", { deprecated: true })] },
    { id: "anthropic", name: "Anthropic", models: [model("claude-opus-5-5", { name: "Claude Opus 5.5" })] },
  ],
}

const key = await Effect.runPromise(Signature.generate("provider-settings-test"))

const logs: string[] = []
const captured = Logger.layer(
  [Logger.make((options) => void logs.push(`${String(options.message)} ${JSON.stringify(options.message)}`))],
  { mergeWithExisting: true },
)

const it = testEffect(
  ProviderSettings.layer.pipe(
    Layer.provideMerge(ModelLists.layer),
    Layer.provideMerge(ModelCatalog.layerFixture(catalog)),
    Layer.provideMerge(RenInference.layer),
    Layer.provideMerge(Layer.mergeAll(Signer.layerLocal, FetchHttpClient.layer, Access.layer, captured)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          REN_INFERENCE_URL: `http://127.0.0.1:${gateway.port}`,
          REN_MODELS_UPSTREAM: "upstream-test",
          REN_INFERENCE_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
        }),
      ),
    ),
  ),
)

const fields = (value: string) => ({ apiKey: Redacted.make(value) })

const listening = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const notifications = yield* pg.listen(BrainPush.channel)
  const until = (found: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === "barrier" ? Effect.succeed(found) : until([...found, next.payload]))),
    )
  return { collect: pg.notify(BrainPush.channel, "barrier").pipe(Effect.andThen(until([])), Effect.orDie) }
})

const setup = Effect.gen(function* () {
  const organizationId = yield* Seed.organization()
  const admin = yield* Seed.actor(organizationId, "admin")
  const member = yield* Seed.actor(organizationId, "member")
  const other = yield* Seed.organization()
  const lists = yield* ModelLists.Service
  yield* lists.sync
  seen.length = 0
  return { organizationId, admin, member, other, lists, providers: yield* ProviderSettings.Service }
})

const cardIds = (cards: ReadonlyArray<ModelLists.Card>) => cards.map((card) => card.id)

describe("ProviderSettings (Providers P7, P17)", () => {
  it.live("a member sees the page and gets 403 on every change; the gateway hears nothing", () =>
    Effect.gen(function* () {
      const found = yield* setup
      const page = yield* found.providers.page(found.member)
      expect(page.ren).toMatchObject({ enabled: true, newModelsOn: true, modelCount: 2, canManage: false })
      expect(page.ren.free?.used).toBe(41)
      expect(page.available).toHaveLength(35)
      const changes: ReadonlyArray<Effect.Effect<unknown, ProviderSettings.Failure>> = [
        found.providers.update(found.member, "groq", { enabled: false }),
        found.providers.update(found.member, "ren", { enabled: false }),
        found.providers.test(found.member, "groq", fields(secret)),
        found.providers.saveKey(found.member, "groq", fields(secret)),
        found.providers.removeKey(found.member, "groq"),
        found.providers.updateRenModels(found.member, { newModelsOn: false }),
      ]
      for (const change of changes) expect((yield* Effect.flip(change))._tag).toBe("Primitive.Forbidden")
      expect(seen.filter((each) => each.method !== "GET")).toEqual([])
    }),
  )

  it.live(
    "a failed test saves nothing; a saved key reaches only the gateway, and Ren keeps its last 4 characters",
    () =>
      Effect.gen(function* () {
        const found = yield* setup
        logs.length = 0
        expect(yield* found.providers.test(found.admin, "groq", fields("sk-wrong"))).toEqual({
          ok: false,
          message: "Incorrect API key provided.",
        })
        const refused = yield* Effect.flip(found.providers.saveKey(found.admin, "groq", fields("sk-wrong")))
        expect(refused).toMatchObject({ _tag: "Primitive.Invalid", message: "Incorrect API key provided." })
        expect(cardIds(yield* found.lists.list(found.organizationId))).toEqual(["ren"])

        const page = yield* found.providers.saveKey(found.admin, "groq", fields(secret))
        expect(page.cards.find((card) => card.id === "groq")).toMatchObject({
          enabled: true,
          method: "key",
          key: { last4: "9f2c" },
          modelCount: 1,
        })
        expect(
          seen.filter((each) => JSON.stringify(each.body).includes(secret)).map((each) => [each.method, each.path]),
        ).toEqual([["PUT", "/v1/providers/groq/key"]])
        const pg = yield* PgClient.PgClient
        const tables = yield* pg<{
          readonly table_name: string
        }>`select table_name from information_schema.tables where table_schema = 'public'`
        for (const row of tables) {
          const hits = yield* pg<{
            readonly count: number
          }>`select count(*)::int as count from ${pg(row.table_name)} t where t::text like ${`%${secret}%`}`
          expect([row.table_name, hits.at(0)?.count]).toEqual([row.table_name, 0])
        }
        expect(tables.length).toBeGreaterThan(50)
        expect(logs.filter((line) => line.includes(secret))).toEqual([])
      }),
  )

  it.live(
    "a key adds the provider's models; turning the card off removes them and notifies only that organization",
    () =>
      Effect.gen(function* () {
        const found = yield* setup
        const listener = yield* listening
        yield* listener.collect
        yield* found.providers.saveKey(found.admin, "groq", fields(secret))
        const listed = yield* found.lists.list(found.organizationId)
        expect(cardIds(listed)).toEqual(["ren", "groq"])
        expect(listed.at(1)?.models.map((each) => [each.id, each.gateway])).toEqual([["llama-5", "groq/llama-5"]])
        expect(yield* listener.collect).toEqual([`org:${found.organizationId}`])

        yield* found.providers.update(found.admin, "groq", { enabled: false })
        expect(cardIds(yield* found.lists.list(found.organizationId))).toEqual(["ren"])
        expect(seen.at(-3)).toMatchObject({
          method: "PUT",
          path: "/v1/providers/groq",
          body: { enabled: false, method: "key" },
        })
        expect(yield* listener.collect).toEqual([`org:${found.organizationId}`])
        expect(cardIds(yield* found.lists.list(found.other))).toEqual(["ren"])
      }),
  )

  it.live(
    "a Ren model switched off leaves the list after the gateway heard it; New models off keeps today's models on",
    () =>
      Effect.gen(function* () {
        const found = yield* setup
        yield* found.providers.updateRenModels(found.admin, { models: [{ id: "ren/vendor/two", enabled: false }] })
        const told = Schema.decodeUnknownSync(Told)(seen.findLast((each) => each.path === "/v1/ren-models")?.body)
        expect(told.switches).toEqual([{ organizationId: found.organizationId, off: ["ren/vendor/two"] }])
        expect((yield* found.lists.list(found.organizationId)).at(0)?.models.map((each) => each.id)).toEqual([
          "vendor/one",
        ])
        expect((yield* found.lists.list(found.other)).at(0)?.models.map((each) => each.id)).toEqual([
          "vendor/one",
          "vendor/two",
        ])

        const after = yield* found.providers.updateRenModels(found.admin, { newModelsOn: false })
        expect(after.newModelsOn).toBe(false)
        expect(after.models.map((each) => [each.id, each.enabled])).toEqual([
          ["ren/vendor/one", true],
          ["ren/vendor/two", false],
        ])
        const settings = yield* found.lists.settingsOf(found.organizationId)
        expect(ModelLists.renEnabled(settings)("ren/vendor/three")).toBe(false)

        yield* found.providers.update(found.admin, "ren", { enabled: false })
        expect(cardIds(yield* found.lists.list(found.organizationId))).toEqual([])
      }),
  )

  it.live(
    "a changed seat brings its models onto the subscription card, called through seat names on the claude program",
    () =>
      Effect.gen(function* () {
        const found = yield* setup
        seats.splice(0, seats.length, {
          id: "seat_1",
          providerId: "anthropic",
          plan: "max",
          models: ["claude-opus-5-5", "claude-next"],
        })
        yield* found.providers.changed(found.organizationId)
        const subscription = (yield* found.lists.list(found.organizationId)).find((card) => card.id === "anthropic")
        expect(subscription).toMatchObject({ method: "subscription", protocol: "anthropic-messages" })
        expect(subscription?.models.map((each) => [each.id, each.name, each.gateway, each.runtime])).toEqual([
          ["claude-next", undefined, "seat/anthropic/claude-next", "claude"],
          ["claude-opus-5-5", "Claude Opus 5.5", "seat/anthropic/claude-opus-5-5", "claude"],
        ])
        seats.length = 0
        yield* found.providers.changed(found.organizationId)
        expect((yield* found.lists.list(found.organizationId)).find((card) => card.id === "anthropic")).toBeUndefined()
      }),
  )
})
