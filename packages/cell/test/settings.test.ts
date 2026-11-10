import { describe, expect, setDefaultTimeout } from "bun:test"
import { Provider, Session } from "@opencode/client/effect"
import { Permission } from "@opencode/schema/permission"
import { Skill } from "@opencode/schema/skill"
import { testEffect } from "@ren/executor/testing"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { App } from "@ren/schema/app"
import { AppCatalog } from "@ren/schema/app-catalog"
import { ModelTypes } from "@ren/schema/model-types"
import { Models } from "@ren/schema/models"
import {
  Context,
  DateTime,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Queue,
  Redacted,
  Ref,
  Schema,
  Stream,
  Struct,
} from "effect"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ModelCatalog } from "../src/model-catalog.js"
import { OpenCodeEvents } from "../src/harness/opencode/events.js"
import { McpPeer } from "./lib/mcp.js"
import { ModelsTest } from "./lib/models.js"
import { TestSettings } from "./lib/settings.js"
import { SettingsHarness } from "./lib/settings-harness.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const open = SettingsHarness.open

const searchEndpoint = (baseUrl: string, providers: ReadonlyArray<string>): Models.Endpoint => ({
  id: "ren",
  protocol: "openai-chat",
  baseUrl,
  apiKey: { key: Redacted.make("key") },
  models: [],
  search: providers.map((id) => ({ id, name: id })),
})

describe("settings in the cell", () => {
  it.live(
    "a gateway endpoint sends its callable model ID upstream under its registered name, and an old vendor reference is refused",
    () =>
      Effect.gen(function* () {
        const models: ReadonlyArray<Models.Endpoint> = [
          {
            id: "ren",
            name: "Ren",
            protocol: "openai-chat",
            baseUrl: stub.url,
            apiKey: { key: Redacted.make("gateway-key") },
            models: [Struct.assign(StubModel.modelEntry("stub", "stub-model"), { input: ["text" as const] })],
          },
        ]
        const opened = yield* open(
          TestSettings.layers({ ren: { model: { endpointId: "ren", modelId: "stub/stub-model" } } }),
          {
            models,
            config: JSON.stringify({ model: "ren/stub/stub-model" }),
          },
        )
        const current = yield* opened.client.session.get({ sessionID: opened.sessionID })
        expect(current.model).toMatchObject({ providerID: "ren", id: "stub/stub-model" })
        const available = yield* opened.client.model.list()
        expect(available.data.find((model) => model.id === "stub/stub-model")?.capabilities.input).toEqual(["text"])
        expect([...new Set(available.data.map((model) => String(model.providerID)))]).toEqual(["ren"])
        const turn = stub.script()
        yield* opened.turn(turn)
        expect(turn.calls.at(0)).toMatchObject({
          authorization: "Bearer gateway-key",
          body: { model: "stub/stub-model" },
        })
        expect((yield* opened.client.provider.get({ providerID: Provider.ID.make("ren") })).data.name).toBe("Ren")
        const refused = yield* opened.harness
          .setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: "stub-model" }))
          .pipe(Effect.flip)
        expect(refused._tag).toBe("BrainRejectedError")
      }),
  )
  it.live(
    "a reopened chat restores model-type overrides and cached catalogs before a pull, with fresh credentials",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.promise(async () =>
          realpath(await mkdtemp(join(tmpdir(), "ren-model-reopen-"))),
        )
        const database = join(directory, "opencode.db")
        const sessionId = RenSession.ID.create()
        const stored = new Map<string, string>()
        const calls: Array<{ path: string; model: string; key: string | null }> = []
        const gateway = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch: async (request) => {
                const path = new URL(request.url).pathname
                if (path.endsWith("/transcriptions")) {
                  // oxlint-disable-next-line typescript/no-deprecated -- Read the generated client's multipart request across a real restart.
                  const form = await request.formData()
                  calls.push({
                    path,
                    model: Schema.decodeUnknownSync(Schema.String)(form.get("model")),
                    key: request.headers.get("authorization"),
                  })
                  return Response.json({ text: "Restored transcript" })
                }
                const body = Schema.decodeUnknownSync(
                  Schema.Struct({
                    model: Schema.optionalKey(Schema.String),
                    providerID: Schema.optionalKey(Schema.String),
                  }),
                )(await request.json())
                calls.push({
                  path,
                  model: body.model ?? body.providerID ?? "",
                  key: request.headers.get("authorization"),
                })
                if (path.endsWith("/generations")) return Response.json({ created: 1, data: [] })
                if (path.endsWith("/decisions")) return Response.json({ answers: [] })
                return Response.json([])
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const types = ["image_generation", "audio_transcription", "decisions"] as const
        const defaults = Object.fromEntries(
          types.map((type) => [type, { providerId: "media", modelId: `default-${type}` }]),
        )
        const overrides = Object.fromEntries(
          types.map((type) => [type, { providerId: "media", modelId: `chosen-${type}` }]),
        )
        const layers = TestSettings.layers({ ren: { defaultModels: defaults } })
        yield* Effect.scoped(
          Effect.gen(function* () {
            const catalog = Context.get(
              yield* Layer.build(ModelCatalog.layer.pipe(Layer.provide(ModelsTest.storage(stored)))),
              ModelCatalog.Service,
            )
            yield* catalog.save({
              endpoints: [
                {
                  id: "media",
                  protocol: "openai-chat",
                  baseUrl: `${gateway.url.origin}/v1`,
                  search: [
                    { id: "default-search", name: "Default" },
                    { id: "chosen-search", name: "Chosen" },
                  ],
                  models: types.flatMap((type) => [
                    { id: `default-${type}`, type: ModelTypes.modelType[type], protocol: "openai-chat" as const },
                    { id: `chosen-${type}`, type: ModelTypes.modelType[type], protocol: "openai-chat" as const },
                  ]),
                },
              ],
            })
            const first = yield* open(layers, {
              config: JSON.stringify({ websearch: { provider: "media/chosen-search" } }),
              database,
              sessionId,
              stored,
              directory,
              catalog,
              refreshKey: () => Effect.succeed(Option.some({ key: Redacted.make("old-key") })),
            })
            yield* first.pull(layers)
            yield* first.harness.start({ sessionId, harness: "opencode", interactive: true, defaultModels: overrides })
            yield* Effect.promise(() => Bun.write(join(directory, sessionId, "clip.wav"), "audio"))
            yield* first.turn(
              stub.script({
                tool: {
                  name: "execute",
                  input: { code: 'return await tools.decisions({ input: "Before restart", questions: [] })' },
                },
              }),
            )
            expect(calls).toEqual([{ path: "/v1/decisions", model: "chosen-decisions", key: "Bearer old-key" }])
          }),
        )
        calls.length = 0
        const catalog = Context.get(
          yield* Layer.build(ModelCatalog.layer.pipe(Layer.provide(ModelsTest.storage(stored)))),
          ModelCatalog.Service,
        )
        const opened = yield* open(TestSettings.layers(), {
          config: JSON.stringify({ websearch: { provider: "media/chosen-search" } }),
          database,
          sessionId,
          stored,
          directory,
          catalog,
          restore: true,
          start: false,
          refreshKey: () => Effect.succeed(Option.some({ key: Redacted.make("fresh-key") })),
        })
        const turn = stub.script({
          tools: [
            { name: "execute", input: { code: 'return await tools.audio_transcription({ file: "clip.wav" })' } },
            {
              name: "execute",
              input: { code: 'return await tools.decisions({ input: "After restart", questions: [] })' },
            },
            { name: "websearch", input: { query: "Effect" } },
          ],
        })
        yield* opened.client.session
          .prompt({ sessionID: opened.sessionID, text: `${turn.marker} go` })
          .pipe(Effect.orDie)
        yield* opened.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
        expect(calls.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
          { path: "/v1/audio/transcriptions", model: "chosen-audio_transcription", key: "Bearer fresh-key" },
          { path: "/v1/decisions", model: "chosen-decisions", key: "Bearer fresh-key" },
          { path: "/v1/search", model: "chosen-search", key: "Bearer fresh-key" },
        ])
      }),
  )
  it.live(
    "transcription, decisions and search use their endpoint URL, headers and credentials instead of the chat key",
    () =>
      Effect.gen(function* () {
        const calls: Array<{ path: string; key: string | null; route: string | null }> = []
        const gateway = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch: (request) => {
                const path = new URL(request.url).pathname
                calls.push({ path, key: request.headers.get("authorization"), route: request.headers.get("x-route") })
                if (path.endsWith("/generations")) return Response.json({ created: 1, data: [] })
                if (path.endsWith("/transcriptions")) return Response.json({ text: "Transcript" })
                if (path.endsWith("/decisions")) return Response.json({ answers: [] })
                return Response.json([])
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const types = ["audio_transcription", "decisions", "search"] as const
        const layers = TestSettings.layers({
          ren: {
            defaultModels: Object.fromEntries(
              types.filter((type) => type !== "search").map((type) => [type, { providerId: type, modelId: "chosen" }]),
            ),
          },
        })
        const opened = yield* open(layers, {
          config: JSON.stringify({ websearch: { provider: "search/chosen" } }),
          refreshKey: (id) =>
            Effect.succeed(id === "stub" ? Option.some({ key: Redacted.make("ren-chat-key") }) : Option.none()),
        })
        yield* Effect.promise(() => Bun.write(join(opened.directory, opened.sessionId, "clip.wav"), "audio"))
        yield* opened.pull(layers, {
          models: [
            ...opened.access.endpoints,
            ...types.map((type) => ({
              id: type,
              protocol: "openai-chat" as const,
              baseUrl: `${gateway.url.origin}/${type}/v1`,
              apiKey: { key: Redacted.make(`${type}-key`) },
              headers: { "x-route": type },
              models:
                type === "search"
                  ? []
                  : [{ id: "chosen", type: ModelTypes.modelType[type], protocol: "openai-chat" as const }],
              search: type === "search" ? [{ id: "chosen", name: "Chosen" }] : [],
            })),
          ],
        })
        expect(
          (yield* opened.client.websearch.providers({
            location: { directory: join(opened.directory, opened.sessionId) },
          })).data.map((provider) => String(provider.id)),
        ).toContain("search/chosen")
        yield* opened.turn(
          stub.script({
            tools: [
              { name: "execute", input: { code: 'return await tools.audio_transcription({ file: "clip.wav" })' } },
              { name: "execute", input: { code: 'return await tools.decisions({ input: "Review", questions: [] })' } },
              { name: "websearch", input: { query: "Effect" } },
            ],
          }),
        )
        expect(calls.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
          {
            path: "/audio_transcription/v1/audio/transcriptions",
            key: "Bearer audio_transcription-key",
            route: "audio_transcription",
          },
          { path: "/decisions/v1/decisions", key: "Bearer decisions-key", route: "decisions" },
          { path: "/search/v1/search", key: "Bearer search-key", route: "search" },
        ])
      }),
  )
  it.live("Ren search works without provider consent by default", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const provider = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: (request) => {
              calls.push(new URL(request.url).pathname)
              return Response.json([{ url: "https://example.com", content: "Result", time: {} }])
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const layers = TestSettings.layers()
      const opened = yield* open(layers)
      yield* opened.pull(layers, {
        models: [...opened.access.endpoints, searchEndpoint(`${provider.url.origin}/v1`, ["search"])],
      })
      const result = yield* opened.client.websearch.query({
        query: "Effect",
        location: { directory: join(opened.directory, opened.sessionId) },
      })
      expect(String(result.data.providerID)).toBe("ren/search")
      yield* opened.turn(stub.script({ tool: { name: "websearch", input: { query: "Effect" } } }))
      expect(calls).toEqual(["/v1/search", "/v1/search"])
    }),
  )
  it.live("Ren search honors explicit OpenCode disablement", () =>
    Effect.gen(function* () {
      const layers = TestSettings.layers()
      const opened = yield* open(layers, { config: JSON.stringify({ websearch: false }) })
      yield* opened.pull(layers, {
        models: [...opened.access.endpoints, searchEndpoint("http://127.0.0.1:1/v1", ["search"])],
      })
      expect(
        (yield* opened.client.websearch.providers({
          location: { directory: join(opened.directory, opened.sessionId) },
        })).data.some((provider) => provider.id === "ren/search"),
      ).toBe(true)
      const result = yield* opened.client.websearch
        .query({ query: "Effect", location: { directory: join(opened.directory, opened.sessionId) } })
        .pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(String(result.failure)).toContain("disabled")
    }),
  )
  it.live("native search selects distinct gateway services without agent defaults and reloads catalogs", () =>
    Effect.gen(function* () {
      const calls: Array<{ model: string; session: string | null; path: string; key: string | null }> = []
      const provider = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: async (request) => {
              const body = Schema.decodeUnknownSync(Schema.Struct({ providerID: Schema.String }))(await request.json())
              calls.push({
                model: body.providerID,
                session: request.headers.get("ren-session"),
                path: new URL(request.url).pathname,
                key: request.headers.get("authorization"),
              })
              return Response.json([{ url: "https://example.com", content: "Result", time: {} }])
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const layers = TestSettings.layers()
      const opened = yield* open(layers, { config: JSON.stringify({ websearch: { provider: "other/chosen" } }) })
      yield* opened.pull(layers, {
        models: [
          ...opened.access.endpoints,
          searchEndpoint(`${provider.url.origin}/v1`, ["first", "chosen"]),
          Struct.assign(searchEndpoint(`${provider.url.origin}/other/v1`, ["chosen"]), {
            id: "other",
            apiKey: { key: Redacted.make("other-key") },
          }),
        ],
      })
      const providers = (yield* opened.client.websearch.providers({
        location: { directory: join(opened.directory, opened.sessionId) },
      })).data.map((provider) => String(provider.id))
      expect(providers).toEqual(expect.arrayContaining(["ren/first", "ren/chosen", "other/chosen"]))
      yield* opened.turn(stub.script({ tool: { name: "websearch", input: { query: "Effect" } } }))
      expect(calls).toEqual([{ model: "chosen", session: null, path: "/other/v1/search", key: "Bearer other-key" }])
      yield* opened.pull(layers, { models: opened.access.endpoints })
      expect(
        (yield* opened.client.websearch.providers({
          location: { directory: join(opened.directory, opened.sessionId) },
        })).data.some((provider) => provider.id === "ren/chosen" || provider.id === "other/chosen"),
      ).toBe(false)
    }),
  )
  it.live("chat model-type overrides survive chat-model changes and re-resolve when a catalog changes", () =>
    Effect.gen(function* () {
      const fallback = { providerId: "ren", modelId: "default" }
      const override = { providerId: "ren", modelId: "chosen" }
      const layers = TestSettings.layers({ ren: { defaultModels: { image_generation: fallback } } })
      const opened = yield* open(layers)
      const models = (ids: ReadonlyArray<string>) => [
        ...opened.access.endpoints,
        {
          id: "ren",
          protocol: "openai-chat" as const,
          baseUrl: stub.url,
          apiKey: { key: Redacted.make("key") },
          models: ids.map((id) => ({ id, type: "image" as const, protocol: "openai-images" as const })),
        },
      ]
      yield* opened.pull(layers, {
        models: models(["default", "chosen"]),
      })
      yield* opened.harness.start({
        sessionId: opened.sessionId,
        harness: "opencode",
        interactive: true,
        defaultModels: { image_generation: override },
      })
      const current = Ref.get(Option.getOrThrow(opened.server.chats).latest).pipe(
        Effect.map((chats) => chats.get(opened.sessionId)?.resolved.primary.defaultModels),
      )
      expect(yield* current).toEqual({ image_generation: override })
      yield* opened.harness.setModel(opened.sessionId, Option.none())
      expect(yield* current).toEqual({ image_generation: override })
      yield* opened.harness.configure({
        models: models(["default"]),
      })
      expect(yield* current).toEqual({ image_generation: fallback })
      const session = yield* opened.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      expect(session.metadata?.ren).toMatchObject({ defaultModels: { image_generation: override } })
      yield* opened.harness.configure({
        models: models(["default", "chosen"]),
      })
      expect(yield* current).toEqual({ image_generation: override })
      yield* opened.harness.start({ sessionId: opened.sessionId, harness: "opencode", interactive: true })
      expect(yield* current).toEqual({ image_generation: override })
    }),
  )
  it.live(
    "native image generation refreshes an expired provider credential and reports an authentication failure",
    () =>
      Effect.gen(function* () {
        const calls: Array<string | null> = []
        const renewals: Array<string> = []
        const state = { reject: false }
        const gateway = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch: (request) => {
                const key = request.headers.get("authorization")
                calls.push(key)
                if (key === "Bearer expired" || state.reject)
                  return Response.json({ error: { message: "Expired" } }, { status: 401 })
                return Response.json({ created: 1, data: [{ b64_json: btoa("image bytes") }] })
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const layers = TestSettings.layers()
        const opened = yield* open(layers, {
          refreshKey: (id) =>
            Effect.sync(() => {
              renewals.push(id)
              return Option.some({ key: Redacted.make("renewed"), expiresAt: DateTime.makeUnsafe("2099-01-01") })
            }),
        })
        yield* opened.pull(layers, {
          models: [
            ...opened.access.endpoints,
            {
              id: "image",
              protocol: "openai-chat",
              baseUrl: `${gateway.url.origin}/v1`,
              apiKey: { key: Redacted.make("expired"), expiresAt: DateTime.makeUnsafe("2000-01-01") },
              models: [{ id: "painter", type: "image", protocol: "openai-images" }],
            },
          ],
        })
        const generate = Effect.gen(function* () {
          const notified = yield* opened.harness.chat.events.pipe(
            Stream.filter((event) => event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic"),
            Stream.map((event) =>
              event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic"
                ? event.data.item.payload.text
                : "",
            ),
            Stream.runHead,
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* opened.turn(
            stub.script({
              tool: { name: "experimental_image_generate", input: { prompt: "A logo", path: "logo.png" } },
            }),
          )
          return Option.getOrThrow(yield* Fiber.join(notified))
        })
        expect(yield* generate).toContain('state="completed"')
        expect(calls).toEqual(["Bearer renewed"])
        expect(renewals).toEqual(["image"])
        state.reject = true
        expect(yield* generate).toContain('state="error"')
        expect(calls).toEqual(["Bearer renewed", "Bearer renewed"])
        expect(renewals).toEqual(["image"])
      }),
  )
  it.live("media models never enter the chat model list or become a chat's model", () =>
    Effect.gen(function* () {
      const layers = TestSettings.layers()
      const opened = yield* open(layers)
      yield* opened.pull(layers, {
        models: opened.access.endpoints.map((endpoint) =>
          Struct.evolve(endpoint, {
            models: (models) => [
              ...models,
              { id: "image", type: "image" as const, protocol: "openai-images" as const },
            ],
          }),
        ),
      })
      expect(
        (yield* opened.client.model.list({
          location: { directory: join(opened.directory, opened.sessionId) },
        })).data.some((model) => model.id === "image"),
      ).toBe(false)
      const rejected = yield* opened.harness
        .setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: "image" }))
        .pipe(Effect.result)
      expect(rejected._tag).toBe("Failure")
      const script = stub.script()
      yield* opened.turn(script)
      expect(script.calls.at(0)?.body.model).toBe("stub-model")
    }),
  )
  it.live("a pull during a step reaches the next step: the child and the queued message use the new config", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers({ ren: { instructions: "Parent config." } }))
      const child = stub.script()
      const parent = stub.script({
        hold: true,
        tools: [
          {
            name: "subagent",
            input: { agent: "explore", description: "Read", prompt: `${child.marker} read` },
          },
        ],
      })
      yield* Effect.addFinalizer(() => Effect.sync(parent.release))
      yield* opened.client.session
        .prompt({ sessionID: opened.sessionID, text: `${parent.marker} go` })
        .pipe(Effect.orDie)
      yield* Effect.promise(() => parent.called())
      const queued = stub.script()
      yield* opened.client.session
        .prompt({ sessionID: opened.sessionID, text: `${queued.marker} go`, delivery: "queue" })
        .pipe(Effect.orDie)
      yield* opened.pull(TestSettings.layers({ ren: { instructions: "Next config." } }))
      parent.release()
      yield* opened.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      expect(parent.calls[0]?.system).toContain("Parent config.")
      expect(child.calls[0]?.system).toContain("Next config.")
      expect(child.calls[0]?.system).not.toContain("Parent config.")
      expect(queued.calls[0]?.system).toContain("Next config.")
    }),
  )
  it.live("a pull during a turn applies its instructions, model and app catalog at once", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers({ ren: { instructions: "Before the update." } }))
      const held = stub.script({ hold: true })
      yield* Effect.addFinalizer(() => Effect.sync(held.release))
      yield* opened.client.session.prompt({ sessionID: opened.sessionID, text: `${held.marker} go` }).pipe(Effect.orDie)
      yield* Effect.promise(() => held.called())
      const queued = stub.script({ hold: true })
      yield* Effect.addFinalizer(() => Effect.sync(queued.release))
      yield* opened.client.session
        .prompt({
          sessionID: opened.sessionID,
          text: `${queued.marker} go`,
          delivery: "queue",
        })
        .pipe(Effect.orDie)
      const added = {
        id: "after-update",
        type: "chat" as const,
        protocol: "openai-chat" as const,
        name: "After Update",
        limit: { context: 100_000, output: 4000 },
      }
      yield* opened.pull(
        TestSettings.layers({
          ren: {
            instructions: "After the update.",
            model: { endpointId: "stub", modelId: added.id },
          },
        }),
        {
          models: opened.access.endpoints.map((endpoint) =>
            Struct.evolve(endpoint, { models: (models) => [...models, added] }),
          ),
          apps: Option.some({
            fingerprint: "apps-after-update",
            catalog: {
              apps: [],
              mcps: [],
              skills: [],
              unavailable: [],
            },
          }),
        },
      )
      expect(
        (yield* opened.harness.configuration).find((location) => location.directory.endsWith(opened.sessionId))
          ?.appFingerprint,
      ).toEqual(Option.some("apps-after-update"))
      expect(held.calls[0]?.system).toContain("Before the update.")
      held.release()
      yield* Effect.promise(() => queued.called())
      expect(queued.calls[0]?.system).toContain("After the update.")
      expect(queued.calls[0]?.system).not.toContain("Before the update.")
      expect(queued.calls[0]?.body.model).toBe(added.id)
      queued.release()
      yield* opened.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    }),
  )
  it.live("a catalog that takes a name OpenCode already uses keeps the applied catalog and names both sources", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers())
      const catalog = (fingerprint: string, slug: string) =>
        Option.some(
          Schema.decodeUnknownSync(AppCatalog.Info)({
            fingerprint,
            catalog: {
              apps: [],
              skills: [],
              unavailable: [],
              mcps: [
                {
                  appId: App.ID.create(),
                  appSlug: "tools",
                  slug,
                  server: slug,
                  profile: null,
                  label: null,
                  declaration: {
                    name: "Tools",
                    description: "Tools",
                    transport: { type: "remote", url: "https://127.0.0.1:1/mcp" },
                    auth: { type: "none" },
                  },
                },
              ],
            },
          }),
        )
      const location = Effect.map(opened.harness.configuration, (all) =>
        all.find((each) => each.directory.endsWith(opened.sessionId)),
      )
      yield* opened.pull(TestSettings.layers(), { apps: catalog("first", "search") })
      expect((yield* location)?.appFingerprint).toEqual(Option.some("first"))
      yield* opened.pull(TestSettings.layers(), { apps: catalog("second", "browser") })
      const observed = yield* location
      expect(observed?.appFingerprint).toEqual(Option.some("first"))
      expect(observed?.appConflicts.join("\n")).toContain("tools (app_")
      expect(observed?.appConflicts.join("\n")).toContain("OpenCode")
      yield* opened.pull(TestSettings.layers(), { apps: catalog("third", "search") })
      expect(yield* location).toMatchObject({ appFingerprint: Option.some("third"), appConflicts: [] })
    }),
  )
  it.live("clearing a variant switches the existing session back to the default", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers())
      yield* opened.harness.setModel(
        opened.sessionId,
        Option.some({ endpointId: "stub", modelId: "stub-model", variant: "high" }),
      )
      expect(
        String((yield* opened.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie)).model?.variant),
      ).toBe("high")
      yield* opened.harness.setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: "stub-model" }))
      expect(
        (yield* opened.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie)).model?.variant ??
          "default",
      ).toBe("default")
    }),
  )

  it.live("reopening restores the override and non-interactive policy before direct prompts and model edits", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(async () =>
        realpath(await mkdtemp(join(tmpdir(), "ren-settings-reopen-"))),
      )
      const database = join(directory, "opencode.db")
      const sessionId = RenSession.ID.create()
      const sessionID = Session.ID.make(sessionId)
      const stored = new Map<string, string>()
      const layers = TestSettings.layers({
        ren: { permissions: [{ action: "subagent", resource: "explore", effect: "ask" }] },
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* open(layers, { database, sessionId, interactive: false, stored, directory })
          yield* first.harness.setModel(sessionId, Option.some({ endpointId: "stub", modelId: "stub-other" }))
        }),
      )
      const opened = yield* open(layers, { database, sessionId, start: false, stored, directory })
      yield* opened.pull(
        TestSettings.layers({
          ren: {
            instructions: "Pulled after reopening.",
            permissions: [{ action: "subagent", resource: "explore", effect: "ask" }],
          },
        }),
      )
      const child = stub.script()
      const turn = stub.script()
      yield* opened.client.session.prompt({ sessionID, text: `${turn.marker} go` }).pipe(Effect.orDie)
      yield* opened.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      expect(turn.calls[0]?.system).toContain("Pulled after reopening.")
      expect(turn.calls[0]?.body.model).toBe("stub-other")
      const permission = stub.script({
        tools: [{ name: "subagent", input: { agent: "explore", description: "Look", prompt: `${child.marker} look` } }],
      })
      yield* opened.client.session.prompt({ sessionID, text: `${permission.marker} go` }).pipe(Effect.orDie)
      yield* opened.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      expect(child.calls).toHaveLength(0)
      expect(yield* opened.client.session.form.list({ sessionID }).pipe(Effect.orDie)).toEqual([])
      yield* opened.harness.setModel(sessionId, Option.none())
      expect(String((yield* opened.client.session.get({ sessionID }).pipe(Effect.orDie)).model?.id)).toBe("stub-model")
    }),
  )
  it.live("after start, OpenCode runs Ren's main agent, with Ren's subagents and OpenCode's hidden helpers", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers())
      const agents = yield* opened.server.agents(opened.sessionId).pipe(Effect.orDie)
      expect(
        agents
          .filter((agent) => !agent.hidden)
          .map((agent) => `${agent.id} ${agent.mode}`)
          .toSorted(),
      ).toEqual(["explore subagent", "general subagent", "ren primary"])
      expect(agents.filter((agent) => agent.hidden).length).toBeGreaterThan(0)
      expect(yield* opened.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie)).toMatchObject({
        agent: "ren",
        model: { providerID: "stub", id: "stub-model" },
      })
    }),
  )

  it.live("a main agent named plan runs as Ren's agent, without OpenCode's Plan mode", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({
          ren: { instructions: "Hand off when done." },
          agents: [TestSettings.agent("plan", {}, { isSubagent: false })],
        }),
      )
      const script = stub.script()
      yield* opened.turn(script)
      expect(script.calls[0]?.system).toContain("Hand off when done.")
      expect(JSON.stringify(script.calls[0]?.body.messages)).not.toContain("Plan mode")
    }),
  )

  it.live("the layers' instructions reach the model, and a pulled edit applies at the next turn", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers({ ren: { instructions: "House rules." } }))
      const first = stub.script()
      yield* opened.turn(first)
      expect(first.calls[0]?.system).toContain("House rules.")
      yield* opened.pull(TestSettings.layers({ ren: { instructions: "New rules." } }))
      const second = stub.script()
      yield* opened.turn(second)
      expect(second.calls[0]?.system).toContain("New rules.")
      expect(second.calls[0]?.system).not.toContain("House rules.")
    }),
  )

  it.live("a chat without an environment gets no references", () =>
    Effect.gen(function* () {
      const docs = { alias: "docs", repository: "https://github.com/acme/docs", description: "Product docs" }
      const opened = yield* open(TestSettings.layers({ ren: { references: [docs] } }))
      const first = stub.script()
      yield* opened.turn(first)
      expect(JSON.stringify(first.calls[0]?.body)).not.toContain("Product docs")
    }),
  )

  it.live("a deny rule refuses the call, and a deny for every resource hides the tool", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({
          agents: [
            TestSettings.agent(
              "ren",
              {
                permissions: [
                  { action: "subagent", resource: "explore", effect: "deny" },
                  { action: "question", resource: "*", effect: "deny" },
                ],
              },
              { isSubagent: false },
            ),
            TestSettings.agent("explore"),
          ],
        }),
      )
      const child = stub.script({ reply: "explored" })
      const parent = stub.script({
        tools: [{ name: "subagent", input: { agent: "explore", description: "Look", prompt: `${child.marker} look` } }],
      })
      yield* opened.turn(parent)
      expect(parent.calls[0]?.tools).not.toContain("question")
      expect(parent.calls[0]?.tools).toContain("subagent")
      expect(child.calls).toHaveLength(0)
    }),
  )

  it.live("an app MCP tool that a deny rule covers leaves the model's catalog and never reaches its server", () =>
    Effect.gen(function* () {
      const docs = yield* McpPeer.make()
      const notes = yield* McpPeer.make()
      const layers = TestSettings.layers({
        ren: {
          permissions: [
            { action: "docs_*", resource: "*", effect: "deny" },
            { action: "notes_second", resource: "*", effect: "deny" },
          ],
        },
      })
      const opened = yield* open(layers)
      yield* opened.pull(layers, {
        apps: Option.some(
          McpPeer.catalog("first", [
            { slug: "docs", url: docs.url },
            { slug: "notes", url: notes.url },
          ]),
        ),
      })
      const denied = McpPeer.execute("docs.marker")
      yield* opened.turn(denied)
      const system = denied.calls.at(0)?.system
      expect(system).toContain("tools.notes.marker()")
      expect(system).not.toContain("tools.notes.second()")
      expect(system).not.toContain("tools.docs.")
      expect(system).not.toContain('<server name="docs">')
      expect(McpPeer.result(denied)).toContain("Unknown tool 'docs.marker'")
      expect((yield* Queue.clear(docs.requests)).map((request) => request.method)).not.toContain("tools/call")
      const allowed = McpPeer.execute("notes.marker")
      yield* opened.turn(allowed)
      expect(McpPeer.result(allowed)).toBe("first")
    }),
  )

  it.live("an app skill that a deny rule covers is refused by the skill tool and left out of a mention", () =>
    Effect.gen(function* () {
      const layers = TestSettings.layers({
        ren: { permissions: [{ action: "skill", resource: "secret", effect: "deny" }] },
      })
      const opened = yield* open(layers)
      const body = `secret-${crypto.randomUUID()}`
      yield* opened.pull(layers, {
        apps: Option.some({
          fingerprint: "skills",
          catalog: {
            apps: [],
            mcps: [],
            unavailable: [],
            skills: ["secret", "open"].map((slug) => ({
              appId: App.ID.create(),
              appSlug: "docs",
              slug,
              declaration: {
                type: "content" as const,
                description: `The ${slug} skill`,
                requiredCredentials: [],
                instructions: `${slug} ${body}`,
                files: {},
              },
            })),
          },
        }),
      })
      const refused = stub.script({ tool: { name: "skill", input: { id: "secret" } } })
      yield* opened.turn(refused)
      expect(JSON.stringify(refused.calls.at(-1)?.body.messages)).not.toContain(`secret ${body}`)
      const mentioned = stub.script()
      yield* opened.client.session
        .prompt({
          sessionID: opened.sessionID,
          text: `${mentioned.marker} use them`,
          skills: [{ id: Skill.ID.make("secret") }, { id: Skill.ID.make("open") }],
        })
        .pipe(Effect.andThen(opened.client.experimental.session.wait({ sessionID: opened.sessionID })), Effect.orDie)
      const sent = JSON.stringify(mentioned.calls.at(0)?.body.messages)
      expect([sent.includes(`secret ${body}`), sent.includes(`open ${body}`)]).toEqual([false, true])
      expect(sent).toContain("Ren did not load the skill secret: it is not allowed in this chat.")
    }),
  )

  it.live("a start that Ren sends again keeps the session's model, and a start that names another model sets it", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers())
      const model = Effect.map(
        opened.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie),
        (session) => String(session.model?.id),
      )
      yield* opened.harness.setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: "stub-other" }))
      yield* opened.harness.start({ sessionId: opened.sessionId, harness: "opencode", interactive: true })
      expect(yield* model).toBe("stub-other")
      yield* opened.harness.start({
        sessionId: opened.sessionId,
        harness: "opencode",
        interactive: true,
        model: { endpointId: "stub", modelId: "stub-model" },
      })
      expect(yield* model).toBe("stub-model")
    }),
  )

  it.live("a model the session sets wins over the settings, and a model outside the catalog is refused", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers())
      yield* opened.harness.setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: "stub-other" }))
      const script = stub.script()
      yield* opened.turn(script)
      expect(script.calls[0]?.body.model).toBe("stub-other")
      const refused = yield* opened.harness
        .setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: "gone" }))
        .pipe(Effect.flip)
      expect(refused.message).toContain("stub/gone")
      yield* opened.harness.setModel(opened.sessionId, Option.none())
      const back = stub.script()
      yield* opened.turn(back)
      expect(back.calls[0]?.body.model).toBe("stub-model")
    }),
  )
  it.live(
    "Always lets later calls that a Ren ask rule covers run without asking, and a Ren deny still refuses them",
    () =>
      Effect.gen(function* () {
        const asking = (effect: "ask" | "deny") =>
          TestSettings.layers({
            agents: [
              TestSettings.agent(
                "ren",
                { permissions: [{ action: "webfetch", resource: "https://example.invalid/*", effect }] },
                { isSubagent: false },
              ),
              TestSettings.agent("general"),
              TestSettings.agent("explore"),
            ],
          })
        const opened = yield* open(asking("ask"))
        const events = yield* Queue.unbounded<{ readonly type: string; readonly data: Record<string, unknown> }>()
        yield* OpenCodeEvents.stream(opened.server.fetch).pipe(
          Stream.filter(
            (event): event is { readonly type: string; readonly data: Record<string, unknown> } =>
              Predicate.isObject(event) && Predicate.isString(event.type) && Predicate.isObject(event.data),
          ),
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped,
        )
        const until = (
          types: ReadonlyArray<string>,
        ): Effect.Effect<{ readonly type: string; readonly data: Record<string, unknown> }> =>
          Queue.take(events).pipe(
            Effect.flatMap((event) => (types.includes(event.type) ? Effect.succeed(event) : until(types))),
          )
        yield* until(["server.connected"])
        const fetchOnce = (marker: string) => ({
          tools: [{ name: "webfetch", input: { url: `https://example.invalid/${marker}`, format: "text" } }],
        })
        const send = (script: StubModel.Script) =>
          opened.harness
            .send({
              sessionId: opened.sessionId,
              messageId: RenSession.MessageID.create(),
              prompt: { text: `${script.marker} go` },
              delivery: "steer",
              sender: { userId: "user_1" },
            })
            .pipe(Effect.orDie)
        const first = stub.script(fetchOnce("first"))
        yield* send(first)
        const asked = yield* until(["permission.asked"])
        yield* opened.client.permission
          .reply({
            sessionID: opened.sessionID,
            requestID: Permission.ID.make(String(asked.data.id)),
            decision: "always",
          })
          .pipe(Effect.orDie)
        yield* opened.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
        yield* until(["session.execution.succeeded"])
        const second = stub.script(fetchOnce("second"))
        yield* send(second)
        expect((yield* until(["permission.asked", "session.execution.succeeded"])).type).toBe(
          "session.execution.succeeded",
        )
        yield* opened.pull(asking("deny"))
        const third = stub.script(fetchOnce("third"))
        yield* send(third)
        expect((yield* until(["permission.asked", "session.execution.succeeded"])).type).toBe(
          "session.execution.succeeded",
        )
        expect(JSON.stringify(third.calls.at(-1)?.body.messages.at(-1))).toContain("Permission denied")
      }),
  )
  it.live("a model list change during a busy turn reaches every Location at once", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({ agents: [TestSettings.agent("ren", {}, { isSubagent: false })] }),
      )
      const other = RenSession.ID.create()
      yield* opened.harness.start({ sessionId: other, harness: "opencode", interactive: true })
      const held = stub.script({ hold: true })
      yield* opened.harness
        .send({
          sessionId: opened.sessionId,
          messageId: RenSession.MessageID.create(),
          prompt: { text: `${held.marker} go` },
          delivery: "steer",
          sender: { userId: "user_1" },
        })
        .pipe(Effect.orDie)
      yield* Effect.promise(() => held.called())
      const added = {
        id: "stub-added",
        type: "chat" as const,
        protocol: "openai-chat" as const,
        name: "Stub Added",
        limit: { context: 100_000, output: 4000 },
      }
      yield* opened.harness.configure({
        models: opened.access.endpoints.map((endpoint) =>
          endpoint.id === "stub" ? Struct.evolve(endpoint, { models: (models) => [...models, added] }) : endpoint,
        ),
      })
      const offers = (sessionId: RenSession.ID) =>
        opened.client.model.list({ location: { directory: join(opened.directory, sessionId) } }).pipe(
          Effect.orDie,
          Effect.map((page) => page.data.some((model) => model.id === added.id)),
        )
      expect(yield* offers(other)).toBe(true)
      expect(yield* offers(opened.sessionId)).toBe(true)
      held.release()
      yield* opened.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    }),
  )
  it.live("a removed endpoint loses its credential at once, also while a busy chat's Location had it", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({ agents: [TestSettings.agent("ren", {}, { isSubagent: false })] }),
      )
      const both = Shared.access(
        { stub: Shared.apiKey("stub-key"), anthropic: Shared.apiKey("sk-anthropic") },
        stub.url,
      ).endpoints
      yield* opened.harness.configure({ models: both })
      const stored = opened.server.credentials
        .all()
        .pipe(Effect.map((all) => all.some((credential) => credential.integrationID === "anthropic")))
      expect(yield* stored).toBe(true)
      const held = stub.script({ hold: true })
      yield* opened.harness
        .send({
          sessionId: opened.sessionId,
          messageId: RenSession.MessageID.create(),
          prompt: { text: `${held.marker} go` },
          delivery: "steer",
          sender: { userId: "user_1" },
        })
        .pipe(Effect.orDie)
      yield* Effect.promise(() => held.called())
      yield* opened.harness.configure({ models: both.filter((endpoint) => endpoint.id !== "anthropic") })
      expect(yield* stored).toBe(false)
      held.release()
      yield* opened.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    }),
  )
  it.live("a 401 renews the key once and the call runs again; a second 401 fails the turn", () =>
    Effect.gen(function* () {
      const renewals = { count: 0 }
      const opened = yield* open(
        TestSettings.layers({ agents: [TestSettings.agent("ren", {}, { isSubagent: false })] }),
        {
          refreshKey: () =>
            Effect.sync(() => {
              renewals.count += 1
              return Option.some({ key: Redacted.make(`stub-renewed-${renewals.count}`) })
            }),
        },
      )
      const healed = stub.script({ rejectKey: "stub-key", reply: "healed" })
      yield* opened.turn(healed)
      expect(healed.calls.map(StubModel.keyOf)).toEqual(["stub-key", "stub-renewed-1"])
      expect(renewals.count).toBe(1)
      const refused = stub.script({ status: 401 })
      yield* opened.turn(refused)
      expect(refused.calls).toHaveLength(2)
      expect(renewals.count).toBe(2)
      expect(yield* opened.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie)).toMatchObject({
        outcome: "failed",
      })
    }),
  )
  it.live("a chat whose picked model is gone falls back to its settings' model and gets a message naming both", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({ agents: [TestSettings.agent("ren", {}, { isSubagent: false })] }),
      )
      const picked = {
        id: "stub-picked",
        type: "chat" as const,
        protocol: "openai-chat" as const,
        name: "Stub Picked",
        limit: { context: 100_000, output: 4000 },
      }
      yield* opened.harness.configure({
        models: opened.access.endpoints.map((endpoint) =>
          endpoint.id === "stub" ? Struct.evolve(endpoint, { models: (models) => [...models, picked] }) : endpoint,
        ),
      })
      yield* opened.harness.setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: picked.id }))
      const modelOf = opened.client.session.get({ sessionID: opened.sessionID }).pipe(
        Effect.orDie,
        Effect.map((session) => String(session.model?.id)),
      )
      expect(yield* modelOf).toBe(picked.id)
      yield* opened.pull(TestSettings.layers(), { models: opened.access.endpoints })
      expect(yield* modelOf).toBe("stub-model")
      const notes = JSON.stringify(
        yield* opened.client.session.inbox.list({ sessionID: opened.sessionID }).pipe(Effect.orDie),
      )
      expect(notes).toContain("stub/stub-picked")
      expect(notes).toContain("stub/stub-model")
    }),
  )
  it.live("a chat that switches from one available pick to another gets no message that a model is gone", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({ agents: [TestSettings.agent("ren", {}, { isSubagent: false })] }),
      )
      const first = {
        id: "stub-first",
        type: "chat" as const,
        protocol: "openai-chat" as const,
        name: "Stub First",
        limit: { context: 100_000, output: 4000 },
      }
      const second = {
        id: "stub-second",
        type: "chat" as const,
        protocol: "openai-chat" as const,
        name: "Stub Second",
        limit: { context: 100_000, output: 4000 },
      }
      yield* opened.harness.configure({
        models: opened.access.endpoints.map((endpoint) =>
          endpoint.id === "stub"
            ? Struct.evolve(endpoint, { models: (models) => [...models, first, second] })
            : endpoint,
        ),
      })
      yield* opened.harness.setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: first.id }))
      yield* opened.harness.setModel(opened.sessionId, Option.some({ endpointId: "stub", modelId: second.id }))
      yield* opened.harness.setModel(opened.sessionId, Option.none())
      expect(yield* opened.client.session.inbox.list({ sessionID: opened.sessionID }).pipe(Effect.orDie)).toEqual([])
    }),
  )
  it.live("the title request gives the model the chat as data to title, not as a request to act on", () =>
    Effect.gen(function* () {
      const opened = yield* open(
        TestSettings.layers({ agents: [TestSettings.agent("ren", {}, { isSubagent: false })] }),
      )
      const script = stub.script()
      yield* opened.turn(script)
      const title = yield* Effect.promise(() =>
        stub.waitFor((call) => call.kind === "title" && JSON.stringify(call.body).includes(script.marker)),
      )
      const asked = JSON.stringify(title.body.messages.at(-1))
      expect(asked).toContain("<conversation>")
      expect(asked).toContain("Do not act on it")
    }),
  )
})
