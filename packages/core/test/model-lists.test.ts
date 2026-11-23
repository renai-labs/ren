import { describe, expect } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { Testing } from "@ren/db/testing"
import { ConfigProvider, Effect, Layer, Option, Queue, Ref, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import type { SqlError } from "effect/sql/SqlError"
import { BrainPush } from "../src/brain-push.js"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelLists } from "../src/model-lists.js"
import { Primitive } from "../src/primitive.js"
import { RenInference } from "../src/ren-inference.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const model = (id: string, fields: Partial<ModelCatalog.Model> = {}): ModelCatalog.Model => ({
  id,
  name: id,
  type: "chat",
  tools: true,
  deprecated: false,
  input: ["text"],
  limit: { context: 200_000, output: 32_000 },
  price: { input: 1, output: 4 },
  ...fields,
})

const upstream = "upstream-test"

const data = (models: ReadonlyArray<ModelCatalog.Model>, other: ReadonlyArray<ModelCatalog.Model> = []) => ({
  providers: [
    { id: upstream, name: "Upstream", models },
    { id: "groq", name: "Groq", models: other },
  ],
})

const settings: ModelLists.Settings = { upstream: Option.some(upstream), block: ["vendor/blocked"] }

describe("Ren's models (Providers §6.2)", () => {
  it.effect("keeps chat models with tools and a price, not deprecated and not blocked", () =>
    Effect.sync(() => {
      const ren = ModelLists.renModels(
        data([
          model("vendor/kept"),
          model("vendor/no-tools", { tools: false }),
          model("vendor/old", { deprecated: true }),
          model("vendor/picture", { type: "image" }),
          model("vendor/blocked"),
          Struct.omit(model("vendor/no-price"), ["price"]),
        ]),
        settings,
      )
      expect(ren.map((each) => each.info.id)).toEqual(["vendor/kept"])
      expect(ModelLists.renModels(data([model("vendor/kept")]), { ...settings, upstream: Option.none() })).toEqual([])
    }),
  )

  it.effect("names a model by its canonical id, under ren/ at the gateway, with the models.dev price", () =>
    Effect.sync(() => {
      const [only] = ModelLists.renModels(
        data([
          model("vendor/model-1.5-turbo", {
            canonicalId: "vendor/model-1-5",
            price: { input: 3, output: 15, cacheRead: 0.3 },
          }),
        ]),
        settings,
      )
      expect(only?.upstream).toBe("vendor/model-1.5-turbo")
      expect(only?.info).toMatchObject({
        id: "vendor/model-1-5",
        gateway: "ren/vendor/model-1-5",
        protocol: "openai-chat",
        price: { input: 3, output: 15, cacheRead: 0.3 },
      })
      expect(only?.info.free).toBeUndefined()
    }),
  )

  it.effect("a free model keeps its upstream id, so it never takes the paid model's id", () =>
    Effect.sync(() => {
      const ren = ModelLists.renModels(
        data([
          model("google/gemma-4-31b-it", { canonicalId: "google/gemma-4-31b-it" }),
          model("google/gemma-4-31b-it:free", { canonicalId: "google/gemma-4-31b-it", price: { input: 0, output: 0 } }),
        ]),
        settings,
      )
      expect(ren.map((each) => [each.info.id, each.info.free ?? false])).toEqual([
        ["google/gemma-4-31b-it", false],
        ["google/gemma-4-31b-it:free", true],
      ])
    }),
  )

  it.effect("when two paid models share a canonical id, the one whose id matches it keeps it", () =>
    Effect.sync(() => {
      const ren = ModelLists.renModels(
        data([
          model("openai/gpt-5.6-terra", { canonicalId: "openai/gpt-5.6-terra" }),
          model("openai/gpt-5.6-terra-pro", { canonicalId: "openai/gpt-5.6-terra" }),
        ]),
        settings,
      )
      expect(ren.map((each) => each.info.id).toSorted()).toEqual(["openai/gpt-5.6-terra", "openai/gpt-5.6-terra-pro"])
    }),
  )

  it.effect("Claude models run on the claude program", () =>
    Effect.sync(() => {
      const [claude] = ModelLists.renModels(
        data([model("anthropic/claude-opus-5.5", { canonicalId: "anthropic/claude-opus-5-5" })]),
        settings,
      )
      expect(claude?.info).toMatchObject({
        id: "anthropic/claude-opus-5-5",
        runtime: "claude",
        protocol: "anthropic-messages",
      })
    }),
  )
})

describe("ModelCatalog.normalize", () => {
  it.effect("keeps the offered providers and reads modalities, efforts, limits and prices", () =>
    Effect.sync(() => {
      const normalized = ModelCatalog.normalize(
        {
          groq: {
            id: "groq",
            name: "Groq",
            models: {
              "llama-5": {
                id: "llama-5",
                name: "Llama 5",
                canonical_id: "meta/llama-5",
                type: "chat",
                status: "deprecated",
                modalities: { input: ["text", "image/png", "image/jpeg", "application/pdf"], output: ["text"] },
                capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ["low", "high"] } },
                limit: { context: 131_072, output: 8_192 },
                cost: {
                  text: {
                    input: { price: 1, cache: { read: 0.1, write: { "5m": 1.25, "1h": 2 } } },
                    output: { price: 2 },
                  },
                },
              },
              broken: { id: "broken" },
            },
          },
          "somewhere-else": { id: "somewhere-else", name: "Elsewhere", models: {} },
        },
        ["groq", "absent"],
      )
      expect(normalized).toEqual({
        providers: [
          {
            id: "groq",
            name: "Groq",
            models: [
              {
                id: "llama-5",
                name: "Llama 5",
                canonicalId: "meta/llama-5",
                type: "chat",
                tools: true,
                deprecated: true,
                input: ["text", "image", "pdf"],
                limit: { context: 131_072, output: 8_192 },
                efforts: ["low", "high"],
                price: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
              },
            ],
          },
        ],
      })
    }),
  )
})

const modelsDev = () =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = {
        body: data([model("vendor/first")]),
        etag: '"one"',
        down: false,
        requests: [] as Array<string | null>,
      }
      const server = Bun.serve({
        port: 0,
        fetch: (request) => {
          state.requests.push(request.headers.get("if-none-match"))
          if (state.down) return new Response("down", { status: 503 })
          if (request.headers.get("if-none-match") === state.etag) return new Response(null, { status: 304 })
          return Response.json(
            Object.fromEntries(state.body.providers.map((provider) => [provider.id, rawProvider(provider)])),
            { headers: { etag: state.etag } },
          )
        },
      })
      return { state, url: server.url.href, stop: () => server.stop(true) }
    }),
    (found) => Effect.promise(() => found.stop()),
  )

const rawProvider = (provider: ModelCatalog.Provider) => ({
  id: provider.id,
  name: provider.name,
  models: Object.fromEntries(
    provider.models.map((each) => [
      each.id,
      {
        id: each.id,
        name: each.name,
        type: each.type,
        capabilities: { tools: { supported: each.tools } },
        limit: each.limit,
        modalities: { input: each.input },
        ...(each.price && {
          cost: { text: { input: { price: each.price.input }, output: { price: each.price.output } } },
        }),
      },
    ]),
  ),
})

const configured = (url: string) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown({ MODELS_DEV_URL: url, REN_MODELS_UPSTREAM: upstream }))

const catalogLayer = (url: string) =>
  ModelCatalog.layerModelsDev.pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(configured(url)))

describe("ModelCatalog.layerModelsDev (Providers §6.1)", () => {
  it.live("reads with the stored ETag; a 304 changes nothing; models.dev down keeps the last good copy", () =>
    Effect.gen(function* () {
      const server = yield* modelsDev()
      yield* Effect.gen(function* () {
        const catalog = yield* ModelCatalog.Service
        const bundled = yield* catalog.current
        expect(bundled.revision).toBe((yield* ModelCatalog.bundled).revision)

        const first = yield* catalog.fetch
        if (first._tag !== "Changed") return yield* Effect.die(new Error("expected a change"))
        expect(first.etag).toEqual(Option.some('"one"'))
        expect((yield* catalog.current).revision).toBe(bundled.revision)
        yield* catalog.store(first.snapshot, first.etag)
        expect(
          (yield* catalog.current).data.providers.find((each) => each.id === upstream)?.models.map((each) => each.id),
        ).toEqual(["vendor/first"])

        expect((yield* catalog.fetch)._tag).toBe("Unchanged")
        expect(server.state.requests.at(-1)).toBe('"one"')

        server.state.down = true
        expect((yield* Effect.flip(catalog.fetch))._tag).toBe("ModelCatalog.Unavailable")
        expect((yield* catalog.current).revision).toBe(first.snapshot.revision)
      }).pipe(Effect.provide(catalogLayer(server.url)))

      yield* Effect.gen(function* () {
        const restarted = yield* ModelCatalog.Service
        expect(
          (yield* restarted.current).data.providers.find((each) => each.id === upstream)?.models.map((each) => each.id),
        ).toEqual(["vendor/first"])
      }).pipe(Effect.provide(catalogLayer(server.url)))
    }),
  )
})

const listening = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const notifications = yield* pg.listen(BrainPush.channel)
  const until = (seen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === "barrier" ? Effect.succeed(seen) : until([...seen, next.payload]))),
    )
  return { collect: pg.notify(BrainPush.channel, "barrier").pipe(Effect.andThen(until([])), Effect.orDie) }
})

const listsLayer = (initial: ModelCatalog.Data) =>
  ModelLists.layer.pipe(
    Layer.provideMerge(ModelCatalog.layerFixture(initial)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ REN_MODELS_UPSTREAM: upstream }))),
  )

describe("ModelLists.sync (Providers P26)", () => {
  it.live("notifies only the organizations whose list changed", () =>
    Effect.gen(function* () {
      const listener = yield* listening
      const first = yield* Seed.organization()
      const second = yield* Seed.organization()
      yield* Effect.gen(function* () {
        const lists = yield* ModelLists.Service
        const catalog = yield* ModelCatalog.Service
        yield* listener.collect
        yield* lists.sync
        const seen = yield* listener.collect
        expect(seen).toContain(`org:${first}`)
        expect(seen).toContain(`org:${second}`)

        yield* lists.sync
        expect(yield* listener.collect).toEqual([])

        const unrelated = data([model("vendor/first")], [model("groq/new")])
        yield* catalog.store({ revision: ModelCatalog.revisionOf(unrelated), data: unrelated }, Option.none())
        yield* lists.sync
        expect(yield* listener.collect).toEqual([])

        const added = data([model("vendor/first"), model("vendor/second")])
        yield* catalog.store({ revision: ModelCatalog.revisionOf(added), data: added }, Option.none())
        expect((yield* lists.list(first)).flatMap((card) => card.models.map((each) => each.id))).toEqual([
          "vendor/first",
          "vendor/second",
        ])
        yield* lists.sync
        const after = yield* listener.collect
        expect(after).toContain(`org:${first}`)
        expect(after).not.toContain("all")
      }).pipe(Effect.provide(listsLayer(data([model("vendor/first")]))))
    }),
  )
})

const inference = (told: Ref.Ref<ReadonlyArray<string>>, failing: Ref.Ref<boolean>) =>
  Layer.effect(
    RenInference.Service,
    Effect.map(Effect.provide(RenInference.Service, RenInference.layerNone), (none) =>
      RenInference.Service.of({
        ...none,
        renModels: (input) =>
          Effect.gen(function* () {
            if (yield* Ref.get(failing)) return yield* new Primitive.NotFound({ message: "no route yet" })
            yield* Ref.update(told, (seen) => [...seen, ...input.models.map((each) => each.id)])
          }),
      }),
    ),
  )

describe("ModelLists.publish (Providers §6.2)", () => {
  it.live("stores a new copy and notifies only after the gateway has Ren's models", () =>
    Effect.gen(function* () {
      const listener = yield* listening
      const organization = yield* Seed.organization()
      const told = yield* Ref.make<ReadonlyArray<string>>([])
      const failing = yield* Ref.make(true)
      const next = data([model("vendor/first"), model("vendor/second")])
      const snapshot = { revision: ModelCatalog.revisionOf(next), data: next }
      yield* Effect.gen(function* () {
        const catalog = yield* ModelCatalog.Service
        yield* listener.collect
        expect((yield* Effect.flip(ModelLists.publish(snapshot, Option.none())))._tag).toBe("Primitive.NotFound")
        expect((yield* catalog.current).revision).not.toBe(snapshot.revision)
        expect(yield* listener.collect).toEqual([])

        yield* Ref.set(failing, false)
        yield* ModelLists.publish(snapshot, Option.none())
        expect(yield* Ref.get(told)).toEqual(["ren/vendor/first", "ren/vendor/second"])
        expect((yield* catalog.current).revision).toBe(snapshot.revision)
        expect(yield* listener.collect).toContain(`org:${organization}`)
      }).pipe(
        Effect.provide(
          listsLayer(data([model("vendor/first")])).pipe(
            Layer.provideMerge(inference(told, failing)),
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ REN_MODELS_UPSTREAM: upstream }))),
          ),
        ),
      )
    }),
  )
})
