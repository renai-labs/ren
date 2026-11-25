import { describe, expect } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import { Testing } from "@ren/db/testing"
import { Effect, Layer, Queue, Redacted } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { Access } from "../src/access.js"
import { BrainPush } from "../src/brain-push.js"
import { ModelLists } from "../src/model-lists.js"
import { ModelGateway } from "../src/model-gateway.js"
import { ProviderSettings } from "../src/provider-settings.js"
import { RenInference } from "../src/ren-inference.js"
import { testEffect } from "./lib/effect.js"
import { TestModelGateway } from "./lib/model-gateway.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const secret = "good-own-key-never-stored-9f2c"

const fields = (value: string) => ({ apiKey: Redacted.make(value) })

const groq = TestModelGateway.provider("groq", {
  name: "Groq",
  payer: "customer",
  auth: [{ _tag: "key", fields: [{ name: "apiKey", label: "API key", secret: true }] }],
})

const listening = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const notifications = yield* pg.listen(BrainPush.channel)
  const until = (found: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === "barrier" ? Effect.succeed(found) : until([...found, next.payload]))),
    )
  return { collect: pg.notify(BrainPush.channel, "barrier").pipe(Effect.andThen(until([])), Effect.orDie) }
})

// oxlint-disable-next-line ren/no-comments -- Ren (the deployment connects it) and Groq (an own key), each with its models, and two organizations.
const setup = Effect.gen(function* () {
  const test = yield* TestModelGateway.make({ providers: [TestModelGateway.provider("ren"), groq] })
  yield* test.setModels("ren", {
    revision: "1",
    models: [
      { ...TestModelGateway.model("vendor/one"), gateway: "ren/vendor/one" },
      { ...TestModelGateway.model("vendor/two"), gateway: "ren/vendor/two" },
    ],
  })
  yield* test.setModels("groq", {
    revision: "1",
    models: [{ ...TestModelGateway.model("llama-5"), gateway: "groq/llama-5" }],
  })
  const organizationId = yield* Seed.organization()
  const other = yield* Seed.organization()
  const context = yield* Layer.build(
    ProviderSettings.layer.pipe(
      Layer.provideMerge(ModelLists.layer),
      Layer.provideMerge(ModelGateway.layer([Effect.succeed(test.gateway)])),
      Layer.provideMerge(Access.layer),
      Layer.provide(RenInference.layerNone),
    ),
  )
  const lists = yield* ModelLists.Service.pipe(Effect.provideContext(context))
  return {
    test,
    organizationId,
    other,
    admin: yield* Seed.actor(organizationId, "admin"),
    member: yield* Seed.actor(organizationId, "member"),
    lists,
    providers: yield* ProviderSettings.Service.pipe(Effect.provideContext(context)),
  }
})

const providersOf = (entries: ReadonlyArray<ModelLists.Entry>) =>
  entries.map((entry) => [entry.id, entry.models.map((model) => model.id)])

describe("ProviderSettings (Providers P7, P17, P29)", () => {
  it.live("a member sees the page and is refused every change; the gateway hears nothing", () =>
    Effect.gen(function* () {
      const found = yield* setup
      const page = yield* found.providers.page(found.member)
      expect(
        page.providers.map((each) => [each.id, each.builtIn, each.added, each.modelTypes, each.canManage]),
      ).toEqual([
        ["ren", true, true, { chat: 2 }, false],
        ["groq", false, false, { chat: 0 }, false],
      ])
      const changes: ReadonlyArray<Effect.Effect<unknown, ProviderSettings.Failure>> = [
        found.providers.update(found.member, "ren", { enabled: false }),
        found.providers.test(found.member, "groq", fields(secret)),
        found.providers.connect(found.member, "groq", fields(secret)),
        found.providers.disconnect(found.member, "groq"),
        found.providers.updateModels(found.member, "ren", { models: [{ id: "ren/vendor/two", enabled: false }] }),
      ]
      for (const change of changes) expect((yield* Effect.flip(change))._tag).toBe("Primitive.Forbidden")
      expect(yield* found.test.gateway.settings(found.organizationId)).toEqual({})
      expect(yield* found.test.keyOf("groq", found.organizationId)).toBeUndefined()
    }),
  )

  it.live(
    "a refused key saves nothing; a saved key reaches only the gateway, and Ren keeps its last 4 characters",
    () =>
      Effect.gen(function* () {
        const found = yield* setup
        expect(yield* found.providers.test(found.admin, "groq", fields("bad-key"))).toEqual({
          ok: false,
          message: "Invalid API Key",
        })
        const refused = yield* Effect.flip(found.providers.connect(found.admin, "groq", fields("bad-key")))
        expect(refused).toMatchObject({ _tag: "Primitive.Invalid", message: "Invalid API Key" })
        expect((yield* found.providers.page(found.admin)).providers.map((each) => [each.id, each.added])).toEqual([
          ["ren", true],
          ["groq", false],
        ])

        const page = yield* found.providers.connect(found.admin, "groq", fields(secret))
        expect(page.providers.find((each) => each.id === "groq")).toMatchObject({
          enabled: true,
          method: "key",
          key: { last4: "9f2c" },
          added: true,
          modelTypes: { chat: 1 },
        })
        expect(yield* found.test.keyOf("groq", found.organizationId)).toBe(secret)
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
      }),
  )

  it.live(
    "a saved key adds the provider's models; the provider off removes them; each change notifies only its organization",
    () =>
      Effect.gen(function* () {
        const found = yield* setup
        const listener = yield* listening
        yield* listener.collect
        yield* found.providers.connect(found.admin, "groq", fields(secret))
        expect(providersOf(yield* found.lists.list(found.organizationId))).toEqual([
          ["ren", ["vendor/one", "vendor/two"]],
          ["groq", ["llama-5"]],
        ])
        expect(yield* listener.collect).toEqual([`org:${found.organizationId}`])

        yield* found.providers.update(found.admin, "groq", { enabled: false })
        expect((yield* found.test.gateway.settings(found.organizationId)).groq).toMatchObject({
          enabled: false,
          method: "key",
          off: [],
          key: { last4: "9f2c" },
        })
        expect(providersOf(yield* found.lists.list(found.organizationId))).toEqual([
          ["ren", ["vendor/one", "vendor/two"]],
        ])
        expect(yield* listener.collect).toEqual([`org:${found.organizationId}`])
        expect(providersOf(yield* found.lists.list(found.other))).toEqual([["ren", ["vendor/one", "vendor/two"]]])
      }),
  )

  it.live("a provider that is on without a key never reaches the organization's list (Providers §6.4.1)", () =>
    Effect.gen(function* () {
      const found = yield* setup
      yield* found.providers.update(found.admin, "groq", { enabled: true })
      expect((yield* found.test.gateway.settings(found.organizationId)).groq).toMatchObject({ enabled: true })
      expect(providersOf(yield* found.lists.list(found.organizationId))).toEqual([
        ["ren", ["vendor/one", "vendor/two"]],
      ])
    }),
  )

  it.live("a provider's models list the latest release first, and a model without a date last", () =>
    Effect.gen(function* () {
      const found = yield* setup
      yield* found.test.setModels("groq", {
        revision: "2",
        models: [
          { ...TestModelGateway.model("undated"), gateway: "groq/undated" },
          { ...TestModelGateway.model("older"), gateway: "groq/older", released: "2025-01-23" },
          { ...TestModelGateway.model("newest"), gateway: "groq/newest", released: "2026-10-02" },
        ],
      })
      const listed = yield* found.providers.models(found.member, "groq")
      expect(listed.models.map((model) => model.id)).toEqual(["groq/newest", "groq/older", "groq/undated"])
    }),
  )

  it.live("a model switched off leaves only its organization's list, after the gateway heard it", () =>
    Effect.gen(function* () {
      const found = yield* setup
      const after = yield* found.providers.updateModels(found.admin, "ren", {
        models: [{ id: "ren/vendor/two", enabled: false }],
      })
      expect(after.models.map((model) => [model.id, model.enabled])).toEqual([
        ["ren/vendor/one", true],
        ["ren/vendor/two", false],
      ])
      expect((yield* found.test.gateway.settings(found.organizationId)).ren).toEqual({
        enabled: true,
        off: ["ren/vendor/two"],
      })
      expect(providersOf(yield* found.lists.list(found.organizationId))).toEqual([["ren", ["vendor/one"]]])
      expect(providersOf(yield* found.lists.list(found.other))).toEqual([["ren", ["vendor/one", "vendor/two"]]])

      yield* found.providers.update(found.admin, "ren", { enabled: false })
      expect(yield* found.lists.list(found.organizationId)).toEqual([])
    }),
  )
})
