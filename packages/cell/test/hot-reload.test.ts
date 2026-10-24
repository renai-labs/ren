import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { SessionID } from "@opencode/schema/session-id"
import { PullReply, PullRequest, type PullApps } from "@ren/host-api/ren-host-api"
import { AppCatalog } from "@ren/schema/app-catalog"
import { App } from "@ren/schema/app"
import { AppRelease } from "@ren/schema/app-release"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AppStore } from "../src/app-store.js"
import { BrainKeys } from "../src/brain-keys.js"
import { BrainStorage } from "../src/brain-storage.js"
import { Cell } from "../src/cell.js"
import { CredentialEnv } from "../src/credential-env.js"
import { ChatSettings } from "../src/chat-settings.js"
import { Env } from "../src/env.js"
import { Fence } from "../src/fence.js"
import { Harness } from "../src/harness/harness.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { HostToken } from "../src/host-token.js"
import { HotReload } from "../src/hot-reload.js"
import { ModelStore } from "../src/model-store.js"
import { RenAddress } from "../src/ren-address.js"
import { FakeRen } from "./lib/ren.js"
import { TestSettings } from "./lib/settings.js"
import { TestToken } from "./lib/token.js"
import { Shared } from "./lib/shared.js"

const it = testEffect(Layer.empty)

const provenance = { appId: App.ID.create(), releaseId: AppRelease.ID.create(), appSlug: "notes", version: "1.0.0" }

const catalog = Schema.decodeUnknownSync(AppCatalog.Info)({
  fingerprint: "packages",
  catalog: {
    apps: [provenance],
    skills: [
      {
        ...provenance,
        slug: "notes",
        declaration: {
          type: "content",
          description: "Read notes",
          instructions: "Read the guide.",
          files: { "guide.md": "Notes guide" },
          requiredCredentials: [],
        },
      },
      {
        ...provenance,
        slug: "upstream",
        declaration: {
          type: "upstream",
          upstream: { url: "https://github.com/example/notes", ref: "main", path: "skills/notes" },
          requiredCredentials: [],
        },
      },
    ],
    mcps: [
      {
        ...provenance,
        slug: "remote",
        declaration: {
          name: "Remote",
          description: "Read remote notes",
          transport: { type: "remote", url: "https://notes.invalid/mcp" },
          auth: { type: "header", name: "Authorization", credential: "NOTES_KEY" },
          requiredCredentials: [{ kind: "env", name: "NOTES_KEY", optional: false }],
          timeouts: { startup: 1000, catalog: 2000, execution: 3000 },
        },
      },
      {
        ...provenance,
        slug: "local",
        declaration: {
          name: "Local",
          description: "Read local notes",
          transport: { type: "local", command: ["notes", "--stdio"], cwd: "notes", env: { MODE: "read" } },
          auth: { type: "none" },
          requiredCredentials: [],
        },
      },
      {
        ...provenance,
        slug: "provider",
        declaration: {
          name: "Provider",
          description: "Read provider notes",
          transport: { type: "provider", provider: "composio", toolkit: "notion" },
          auth: { type: "none" },
          requiredCredentials: [],
        },
      },
    ],
    credentials: [{ appId: provenance.appId, requirements: [{ kind: "env", name: "NOTES_KEY", optional: false }] }],
  },
})

const empty: AppCatalog.Info = {
  fingerprint: "empty",
  catalog: { apps: [], skills: [], mcps: [], credentials: [] },
}

const open = Effect.fnUntraced(function* (options: { readonly active?: boolean } = {}) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-hot-reload-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const storage = Layer.succeed(BrainStorage.Service, {
    get: async (key) => {
      const file = Bun.file(join(directory, key))
      return (await file.exists()) ? file.text() : undefined
    },
    put: async (key, value) => {
      await Bun.write(join(directory, key), value)
    },
    delete: (key) => rm(join(directory, key), { force: true }),
  })
  const requests: Array<PullRequest> = []
  const reply = {
    publicKeys: TestToken.publicKeys,
    models: { hash: "models" },
    layers: TestSettings.layers(),
    chats: [],
    deleted: [],
  } satisfies PullReply
  const state: { reply: PullReply } = { reply }
  const token = yield* Effect.promise(() => FakeRen.hostToken())
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          if (new URL(request.url).pathname !== "/host/pull") return new Response(null, { status: 404 })
          if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 })
          requests.push(Schema.decodeUnknownSync(PullRequest)(await request.json()))
          return Response.json(Schema.encodeSync(Schema.toCodecJson(PullReply))(state.reply))
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  const info = Layer.succeed(Cell.Info, {
    brainId: TestToken.brain,
    generation: 1,
    version: "test",
    vars: Schema.decodeUnknownSync(Env.Vars)({ REN_URL: server.url.origin, ...TestToken.vars }),
    storage: { getAlarm: () => Promise.resolve(null), setAlarm: () => Promise.resolve() },
  })
  const services = yield* Layer.build(
    HotReload.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          HostToken.layer(server.url.origin),
          BrainKeys.layer,
          RenAddress.layer(server.url.origin),
          Layer.unwrap(
            Effect.gen(function* () {
              const settings = yield* ChatSettings.Service
              const apps = yield* AppStore.Service
              return Harness.layer(
                options.active
                  ? Effect.gen(function* () {
                      const host = yield* OpenCodeServer.make(
                        (replacements) =>
                          createEmbeddedRoutes(
                            {
                              database: { path: ":memory:" },
                              config: {
                                directory,
                                project: false,
                                content: Shared.vars(Shared.stub().url).OPENCODE_CONFIG,
                              },
                              models: { fetch: false },
                              fs: { filewatcher: false, fff: false },
                            },
                            replacements,
                          ).pipe(Layer.provide(HttpServer.layerServices)),
                        [],
                        () => Effect.succeedNone,
                        Option.none(),
                        {
                          saved: Option.some(settings.saved),
                          apps: yield* apps.current,
                          directoryOf: (sessionId) => join(directory, sessionId),
                          makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
                        },
                      )
                      return yield* OpenCodeHarness.make(host, [], Option.some(settings))
                    })
                  : Effect.die(new Error("A pull must not open the closed harness")),
              )
            }),
          ),
        ),
      ),
      Layer.provideMerge(
        Layer.mergeAll(ModelStore.layer, AppStore.layer, ChatSettings.layer, Cell.activityLayer, CredentialEnv.layer),
      ),
      Layer.provideMerge(Fence.layer),
      Layer.provideMerge(storage),
      Layer.provideMerge(info),
      Layer.provide(FetchHttpClient.layer),
    ),
  )
  yield* Context.get(services, ModelStore.Service).keepHostToken(token)
  const path = join(directory, "ren:apps")
  return {
    path,
    requests,
    reload: Context.get(services, HotReload.Service),
    harness: Context.get(services, Harness.Service),
    answer: (apps?: PullApps, update: Partial<Omit<PullReply, "apps">> = {}) => {
      state.reply = { ...reply, ...update, ...(apps && { apps }) }
    },
    saved: Effect.promise(() => Bun.file(path).text()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(AppCatalog.Info))),
    ),
  }
})

it.live("pull saves only catalog bodies, acknowledges saved fingerprints and keeps the harness closed", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    opened.answer({ fingerprint: "missing-body" })
    yield* opened.reload.pull
    expect(opened.requests.at(-1)?.apps).toBeNull()
    expect(yield* Effect.promise(() => Bun.file(opened.path).exists())).toBe(false)
    opened.answer(catalog)
    yield* opened.reload.pull
    expect(yield* opened.saved).toEqual(catalog)
    opened.answer()
    yield* opened.reload.pull
    expect(opened.requests.at(-1)?.apps).toBe(catalog.fingerprint)
    expect(yield* opened.saved).toEqual(catalog)
    opened.answer(empty)
    yield* opened.reload.pull
    opened.answer({ fingerprint: empty.fingerprint })
    yield* opened.reload.pull
    expect(opened.requests.at(-1)?.apps).toBe(empty.fingerprint)
    expect(yield* opened.saved).toEqual(empty)
    expect(yield* opened.harness.state).toEqual({ isOpen: false, holders: 0 })
  }),
)

it.live("a failed catalog save still applies the rest of the pull and is retried on the next one", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    yield* Effect.promise(() => mkdir(opened.path))
    opened.answer(catalog)
    yield* opened.reload.pull
    yield* opened.reload.pull
    expect(opened.requests.at(-1)?.apps).toBeNull()
    expect(opened.requests.at(-1)?.layers.ren).toBeDefined()
    yield* Effect.promise(() => rm(opened.path, { recursive: true }))
    yield* opened.reload.pull
    expect(yield* opened.saved).toEqual(catalog)
  }),
)

it.live("an open harness gets one saved config even when the new app catalog cannot be saved", () =>
  Effect.gen(function* () {
    const opened = yield* open({ active: true })
    opened.answer(catalog, { layers: TestSettings.layers({ ren: { instructions: "Before pull." } }) })
    yield* opened.reload.pull
    const harness = yield* opened.harness.get
    const sessionId = Session.ID.create()
    yield* harness.start({ sessionId, harness: "opencode", interactive: true })
    const client = yield* OpenCodeServer.client(harness.fetch)
    const sessionID = SessionID.make(sessionId)
    expect(
      (yield* harness.configuration).find((location) => location.directory.endsWith(sessionId))?.appFingerprint,
    ).toEqual(Option.some(catalog.fingerprint))
    const held = Shared.stub().script({ hold: true })
    yield* Effect.addFinalizer(() => Effect.sync(held.release))
    yield* client.session.prompt({ sessionID, text: `${held.marker} go` }).pipe(Effect.orDie)
    yield* Effect.promise(() => held.called())
    yield* Effect.promise(async () => {
      await rm(opened.path)
      await mkdir(opened.path)
    })
    opened.answer(empty, {
      layers: TestSettings.layers({ ren: { instructions: "After pull." } }),
      chats: [{ id: sessionId, agent: null, archived: false }],
    })
    yield* opened.reload.pull
    const queued = Shared.stub().script()
    yield* client.session.prompt({ sessionID, text: `${queued.marker} go`, delivery: "queue" }).pipe(Effect.orDie)
    held.release()
    yield* client.session.wait({ sessionID }).pipe(Effect.orDie)
    expect(queued.calls[0]?.system).toContain("Before pull.")
    const next = Shared.stub().script()
    yield* client.session.prompt({ sessionID, text: `${next.marker} go` }).pipe(Effect.orDie)
    yield* client.session.wait({ sessionID }).pipe(Effect.orDie)
    expect(next.calls[0]?.system).toContain("After pull.")
    expect(
      (yield* harness.configuration).find((location) => location.directory.endsWith(sessionId))?.appFingerprint,
    ).toEqual(Option.some(catalog.fingerprint))
    yield* Effect.promise(() => rm(opened.path, { recursive: true }))
    yield* opened.reload.pull
    expect(
      (yield* harness.configuration).find((location) => location.directory.endsWith(sessionId))?.appFingerprint,
    ).toEqual(Option.some(empty.fingerprint))
  }),
)
