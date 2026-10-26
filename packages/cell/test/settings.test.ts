import { describe, expect, setDefaultTimeout } from "bun:test"
import { OpenCode, Session } from "@opencode/client/effect"
import { Permission } from "@opencode/schema/permission"
import { Skill } from "@opencode/schema/skill"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import { App } from "@ren/schema/app"
import { AppCatalog } from "@ren/schema/app-catalog"
import { Context, Effect, Layer, Option, Predicate, Queue, Redacted, Schema, Stream, Struct } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ChatSettings } from "../src/chat-settings.js"
import type { Harness } from "../src/harness/harness.js"
import type { HarnessConfig } from "../src/harness/config.js"
import { OpenCodeEvents } from "../src/harness/opencode/events.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { McpPeer } from "./lib/mcp.js"
import { ModelsTest } from "./lib/models.js"
import { TestSettings } from "./lib/settings.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const open = Effect.fnUntraced(function* (
  initial: SessionSettings.Layers,
  options: {
    readonly database?: string
    readonly sessionId?: RenSession.ID
    readonly interactive?: boolean
    readonly start?: boolean
    readonly stored?: Map<string, string>
    readonly directory?: string
    readonly refreshKey?: Harness.Refresh
  } = {},
) {
  const access = Struct.evolve(Shared.access(undefined, stub.url), {
    endpoints: (endpoints) =>
      endpoints.map((endpoint) =>
        Struct.evolve(endpoint, {
          models: (models) => models.map((model) => Struct.assign(model, { variants: [{ id: "high" }] })),
        }),
      ),
  })
  const directory =
    options.directory ?? (yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-settings-")))))
  const settings = Context.get(
    yield* Layer.build(ChatSettings.layer.pipe(Layer.provide(ModelsTest.storage(options.stored)))),
    ChatSettings.Service,
  )
  yield* settings.save(initial, [])
  const server = yield* OpenCodeServer.make(
    (replacements) =>
      createEmbeddedRoutes(
        {
          database: { path: options.database ?? ":memory:" },
          config: { directory, project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        replacements,
      ).pipe(Layer.provide(HttpServer.layerServices)),
    access.endpoints,
    options.refreshKey ?? (() => Effect.succeedNone),
    Option.none(),
    {
      saved: Option.some(settings.saved),
      directoryOf: (sessionId) => join(directory, sessionId),
      makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
    },
  )
  const harness = yield* OpenCodeHarness.make(server, access.endpoints, Option.some(settings))
  const client = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(Layer.fresh(FetchHttpClient.layer)),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          server.fetch(new Request(input instanceof Request ? input.url : String(input), init)),
        {
          preconnect: fetch.preconnect,
        },
      ),
    ),
  )
  const sessionId = options.sessionId ?? RenSession.ID.create()
  const sessionID = Session.ID.make(sessionId)
  if (options.start !== false)
    yield* harness.start({ sessionId, harness: "opencode", interactive: options.interactive ?? true })
  const turn = (script: StubModel.Script) =>
    harness
      .send({
        sessionId,
        messageId: RenSession.MessageID.create(),
        prompt: { text: `${script.marker} go` },
        delivery: "steer",
        sender: { userId: "user_1" },
      })
      .pipe(Effect.andThen(client.session.wait({ sessionID })), Effect.orDie)
  const pull = (layers: SessionSettings.Layers, update: Omit<HarnessConfig.Update, "settings"> = {}) =>
    Effect.gen(function* () {
      yield* settings.save(layers, [])
      yield* harness.configure({
        ...update,
        settings: {
          layers: yield* settings.layers,
          chats: [{ id: sessionId, agent: null, archived: false }],
        },
      })
      yield* Shared.appsSettled(harness)
    })
  return { server, harness, client, sessionId, sessionID, turn, pull, directory, access }
})

describe("settings in the cell", () => {
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
      yield* opened.client.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
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
      const added = { id: "after-update", name: "After Update", limit: { context: 100_000, output: 4000 } }
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
      yield* opened.client.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
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
      yield* opened.client.session.wait({ sessionID }).pipe(Effect.orDie)
      expect(turn.calls[0]?.system).toContain("Pulled after reopening.")
      expect(turn.calls[0]?.body.model).toBe("stub-other")
      const permission = stub.script({
        tools: [{ name: "subagent", input: { agent: "explore", description: "Look", prompt: `${child.marker} look` } }],
      })
      yield* opened.client.session.prompt({ sessionID, text: `${permission.marker} go` }).pipe(Effect.orDie)
      yield* opened.client.session.wait({ sessionID }).pipe(Effect.orDie)
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
        .pipe(Effect.andThen(opened.client.session.wait({ sessionID: opened.sessionID })), Effect.orDie)
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
        yield* opened.client.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
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
      const added = { id: "stub-added", name: "Stub Added", limit: { context: 100_000, output: 4000 } }
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
      yield* opened.client.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
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
      yield* opened.client.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
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
      const picked = { id: "stub-picked", name: "Stub Picked", limit: { context: 100_000, output: 4000 } }
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
      const first = { id: "stub-first", name: "Stub First", limit: { context: 100_000, output: 4000 } }
      const second = { id: "stub-second", name: "Stub Second", limit: { context: 100_000, output: 4000 } }
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
