import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { SessionID } from "@opencode/schema/session-id"
import { GenerationRetiredError } from "@ren/host-api/errors"
import { PullReply, PullRequest, type PullApps } from "@ren/host-api/ren-host-api"
import { AppCatalog } from "@ren/schema/app-catalog"
import { App } from "@ren/schema/app"
import { Session } from "@ren/schema/session"
import { Context, Effect, Fiber, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AppStore } from "../src/app-store.js"
import { ChannelStore } from "../src/channel-store.js"
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
import { Inference } from "../src/inference.js"
import { ModelStore } from "../src/model-store.js"
import { RenAddress } from "../src/ren-address.js"
import { FakeRen } from "./lib/ren.js"
import { TestSettings } from "./lib/settings.js"
import { TestToken } from "./lib/token.js"
import { Shared } from "./lib/shared.js"

const it = testEffect(Layer.empty)

const provenance = { appId: App.ID.create(), appSlug: "notes" }

const catalog = Schema.decodeUnknownSync(AppCatalog.Info)({
  fingerprint: "packages",
  catalog: {
    apps: [{ ...provenance, name: "Notes", profiles: [] }],
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
        server: "remote__team",
        profile: { id: "apf_team", slug: "team", name: "Team", kind: "shared" },
        label: "MCP_REMOTE__TEAM",
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
        server: "local",
        profile: null,
        label: null,
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
        server: "provider__team",
        profile: { id: "apf_team", slug: "team", name: "Team", kind: "shared" },
        label: "MCP_PROVIDER__TEAM",
        declaration: {
          name: "Provider",
          description: "Read provider notes",
          transport: { type: "provider", provider: "composio", integration: "notion" },
          auth: { type: "oauth", tokenEndpointAuth: "none" },
          requiredCredentials: [],
        },
      },
    ],
    unavailable: [],
  },
})

const empty: AppCatalog.Info = {
  fingerprint: "empty",
  catalog: { apps: [], skills: [], mcps: [], unavailable: [] },
}

const open = Effect.fnUntraced(function* (
  options: { readonly active?: boolean; readonly pullIntervalMs?: number } = {},
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-hot-reload-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const writes: Array<string> = []
  const failing = new Set<string>()
  const storage = Layer.succeed(BrainStorage.Service, {
    get: async (key) => {
      const file = Bun.file(join(directory, key))
      return (await file.exists()) ? file.text() : undefined
    },
    put: async (key, value) => {
      if (failing.delete(key)) throw new Error(`storage refused ${key}`)
      writes.push(key)
      await Bun.write(join(directory, key), value)
    },
    delete: (key) => rm(join(directory, key), { force: true }),
  })
  const requests: Array<PullRequest> = []
  const reply = {
    publicKeys: TestToken.publicKeys,
    layers: TestSettings.layers(),
    chats: [],
    deleted: [],
    env: { variables: {} },
  } satisfies PullReply
  const state: {
    reply: PullReply
    hold?: { readonly entered: PromiseWithResolvers<void>; readonly release: PromiseWithResolvers<void> }
    retired?: boolean
  } = { reply }
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
          if (state.retired)
            return Response.json(
              Schema.encodeSync(GenerationRetiredError)(
                new GenerationRetiredError({ message: "generation 1 is retired" }),
              ),
              { status: 403 },
            )
          const hold = state.hold
          delete state.hold
          if (hold) {
            hold.entered.resolve()
            await hold.release.promise
          }
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
    vars: Schema.decodeUnknownSync(Env.Vars)({
      REN_URL: server.url.origin,
      ...TestToken.vars,
      ...(options.pullIntervalMs !== undefined && { PULL_INTERVAL_MS: String(options.pullIntervalMs) }),
    }),
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
                              database: { path: join(directory, "opencode.db") },
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
        Layer.mergeAll(
          ModelStore.layer,
          AppStore.layer,
          ChannelStore.layer,
          ChatSettings.layer,
          Cell.activityLayer,
          CredentialEnv.layer,
          Inference.layer,
        ),
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
    writes,
    reload: Context.get(services, HotReload.Service),
    harness: Context.get(services, Harness.Service),
    holdNextPull: () => {
      const hold = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
      state.hold = hold
      return { entered: Effect.promise(() => hold.entered.promise), release: () => hold.release.resolve() }
    },
    env: Context.get(services, CredentialEnv.Service),
    fence: Context.get(services, Fence.Service),
    failNextWrite: (key: string) => void failing.add(key),
    retire: () => {
      state.retired = true
    },
    answer: (apps?: PullApps, update: Partial<Omit<PullReply, "apps">> = {}) => {
      state.reply = { ...reply, ...update, ...(apps && { apps }) }
    },
    saved: Effect.promise(() => Bun.file(path).text()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(AppCatalog.Info))),
    ),
  }
})

it.live("a pull with the same full state writes nothing and keeps the harness closed (HR9)", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    opened.answer(catalog, { env: { variables: { NOTES_KEY: "ren:NOTES_KEY" } } })
    yield* opened.reload.pull
    expect(yield* opened.saved).toEqual(catalog)
    expect(yield* opened.env.current).toEqual({ NOTES_KEY: "ren:NOTES_KEY" })
    const written = opened.writes.length
    yield* opened.reload.pull
    expect(opened.writes.slice(written).filter((key) => key !== "ren:public-keys")).toEqual([])
    expect(opened.requests.at(-1)).toEqual({ version: "test", keyIds: expect.any(Array), sessions: [], roots: [] })
    opened.answer(empty)
    yield* opened.reload.pull
    expect(yield* opened.saved).toEqual(empty)
    expect(yield* opened.env.current).toEqual({})
    expect(yield* opened.harness.state).toEqual({ isOpen: false, holders: 0 })
  }),
)

it.live("a failed catalog save still applies the rest of the pull and is retried on the next one", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    yield* Effect.promise(() => mkdir(opened.path))
    opened.answer(catalog, { env: { variables: { NOTES_KEY: "ren:NOTES_KEY" } } })
    yield* opened.reload.pull
    expect(yield* opened.env.current).toEqual({ NOTES_KEY: "ren:NOTES_KEY" })
    yield* Effect.promise(() => rm(opened.path, { recursive: true }))
    yield* opened.reload.pull
    expect(yield* opened.saved).toEqual(catalog)
  }),
)

it.live("a pull that dies on a storage write does not stop later pushes from pulling", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    opened.failNextWrite("ren:settings-layers")
    opened.answer(undefined, { layers: TestSettings.layers({ ren: { instructions: "First." } }) })
    yield* opened.reload.push
    yield* Effect.sync(() => opened.requests.length).pipe(
      Effect.repeat({ until: (count) => count >= 1, schedule: Schedule.spaced("10 millis") }),
    )
    opened.answer(undefined, { layers: TestSettings.layers({ ren: { instructions: "Second." } }) })
    yield* opened.reload.push
    yield* Effect.sync(() => opened.requests.length).pipe(
      Effect.repeat({ until: (count) => count >= 2, schedule: Schedule.spaced("10 millis") }),
      Effect.timeout("3 seconds"),
    )
  }),
)

it.live("a retired generation fences itself on its pull and applies nothing after that", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    opened.answer(catalog)
    yield* opened.reload.pull
    opened.retire()
    opened.answer(empty)
    yield* opened.reload.pull
    expect(yield* opened.fence.isRetired).toBe(true)
    yield* opened.reload.pull
    expect(opened.requests).toHaveLength(2)
    expect(yield* opened.saved).toEqual(catalog)
  }),
)

it.live("a push during a pull makes exactly one more pull, and that pull returns the later write (HR13)", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const hold = opened.holdNextPull()
    yield* Effect.addFinalizer(() => Effect.sync(hold.release))
    yield* opened.reload.push
    yield* hold.entered
    opened.answer(catalog)
    yield* Effect.forEach(Array.from({ length: 100 }), () => opened.reload.push, { discard: true })
    hold.release()
    yield* Effect.promise(() => Bun.file(opened.path).exists()).pipe(
      Effect.repeat({ until: Boolean, schedule: Schedule.spaced("10 millis") }),
    )
    expect(yield* opened.saved).toEqual(catalog)
    yield* opened.reload.pull
    expect(opened.requests).toHaveLength(3)
  }),
)

it.live(
  "a pull applies a change to an open harness at once, also during a turn, and keeps a catalog it cannot save",
  () =>
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
      expect(queued.calls[0]?.system).toContain("After pull.")
      const revision = (yield* harness.configuration).find((location) => location.directory.endsWith(sessionId))
      expect(revision?.appFingerprint).toEqual(Option.some(catalog.fingerprint))
      yield* opened.reload.pull
      expect(
        (yield* harness.configuration).find((location) => location.directory.endsWith(sessionId))?.desiredRevision,
      ).toBe(revision?.desiredRevision)
      yield* Effect.promise(() => rm(opened.path, { recursive: true }))
      yield* opened.reload.pull
      expect(
        (yield* harness.configuration).find((location) => location.directory.endsWith(sessionId))?.appFingerprint,
      ).toEqual(Option.some(empty.fingerprint))
    }),
)

it.live("a busy chat that Ren deleted is interrupted and dropped, and its model gets no more requests (HR22)", () =>
  Effect.gen(function* () {
    const opened = yield* open({ active: true })
    yield* opened.reload.pull
    const harness = yield* opened.harness.get
    const sessionId = Session.ID.create()
    yield* harness.start({ sessionId, harness: "opencode", interactive: true })
    const client = yield* OpenCodeServer.client(harness.fetch)
    const sessionID = SessionID.make(sessionId)
    const held = Shared.stub().script({ hold: true, tools: [{ name: "todowrite", input: { todos: [] } }] })
    yield* Effect.addFinalizer(() => Effect.sync(held.release))
    yield* client.session.prompt({ sessionID, text: `${held.marker} go` }).pipe(Effect.orDie)
    yield* Effect.promise(() => held.called())
    opened.answer(undefined, { deleted: [sessionId] })
    yield* opened.reload.pull
    held.release()
    expect(yield* harness.transcript.has(sessionId)).toBe(false)
    expect(held.calls).toHaveLength(1)
  }),
)

it.live("a pull names only root chats, so Ren never deletes a running subagent that it has not synced yet", () =>
  Effect.gen(function* () {
    const opened = yield* open({ active: true })
    yield* opened.reload.pull
    const harness = yield* opened.harness.get
    const sessionId = Session.ID.create()
    yield* harness.start({ sessionId, harness: "opencode", interactive: true })
    const client = yield* OpenCodeServer.client(harness.fetch)
    const stub = Shared.stub()
    const child = stub.script({ hold: true })
    yield* Effect.addFinalizer(() => Effect.sync(child.release))
    const parent = stub.script({
      tool: { name: "subagent", input: { agent: "general", description: "Help", prompt: `${child.marker} help` } },
    })
    yield* client.session
      .prompt({ sessionID: SessionID.make(sessionId), text: `${parent.marker} go` })
      .pipe(Effect.orDie)
    yield* Effect.promise(() => child.called())
    yield* opened.reload.pull
    expect(opened.requests.at(-1)?.roots).toEqual([sessionId])
  }),
)

it.live("a pull that finishes after the harness closes does not reopen it to offer config", () =>
  Effect.gen(function* () {
    const opened = yield* open({ active: true })
    yield* opened.reload.pull
    yield* Effect.scoped(
      Effect.flatMap(opened.harness.get, (harness) =>
        harness.start({
          sessionId: Session.ID.create(),
          harness: "opencode",
          interactive: true,
        }),
      ),
    )
    const hold = opened.holdNextPull()
    yield* Effect.addFinalizer(() => Effect.sync(hold.release))
    const pulling = yield* opened.reload.pull.pipe(Effect.forkScoped)
    yield* hold.entered
    yield* opened.harness.close
    expect((yield* opened.harness.state).isOpen).toBe(false)
    hold.release()
    yield* Fiber.join(pulling)
    expect((yield* opened.harness.state).isOpen).toBe(false)
  }),
)

it.live("a pull while the harness is closed reaches the chat when the harness opens again", () =>
  Effect.gen(function* () {
    const opened = yield* open({ active: true })
    const sessionId = Session.ID.create()
    const chats = [{ id: sessionId, agent: null, archived: false }]
    opened.answer(undefined, { layers: TestSettings.layers({ ren: { instructions: "Before close." } }), chats })
    yield* opened.reload.pull
    yield* Effect.scoped(
      Effect.flatMap(opened.harness.get, (harness) =>
        harness.start({ sessionId, harness: "opencode", interactive: true }),
      ),
    )
    yield* opened.harness.close
    opened.answer(undefined, { layers: TestSettings.layers({ ren: { instructions: "While closed." } }), chats })
    yield* opened.reload.pull
    const harness = yield* opened.harness.get
    const client = yield* OpenCodeServer.client(harness.fetch)
    const sessionID = SessionID.make(sessionId)
    const turn = Shared.stub().script()
    yield* client.session.prompt({ sessionID, text: `${turn.marker} go` }).pipe(Effect.orDie)
    yield* client.session.wait({ sessionID }).pipe(Effect.orDie)
    expect(turn.calls[0]?.system).toContain("While closed.")
  }),
)

it.live(
  "the alarm's pull runs only while the harness is open, never waits, and never stacks behind a slow Ren (HR17)",
  () =>
    Effect.gen(function* () {
      const opened = yield* open({ active: true, pullIntervalMs: 1 })
      yield* opened.reload.tick
      expect(opened.requests).toHaveLength(0)
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* opened.harness.get
          const hold = opened.holdNextPull()
          yield* Effect.addFinalizer(() => Effect.sync(hold.release))
          yield* opened.reload.tick.pipe(Effect.timeout("1 second"))
          yield* hold.entered
          yield* Effect.forEach(Array.from({ length: 5 }), () => opened.reload.tick.pipe(Effect.timeout("1 second")), {
            discard: true,
          })
          expect(opened.requests).toHaveLength(1)
          hold.release()
          yield* Effect.sync(() => opened.requests.length).pipe(
            Effect.repeat({ until: (count) => count >= 2, schedule: Schedule.spaced("10 millis") }),
          )
          yield* opened.reload.pull
          expect(opened.requests).toHaveLength(3)
        }),
      )
    }),
)
