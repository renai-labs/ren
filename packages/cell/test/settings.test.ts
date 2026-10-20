import { describe, expect, setDefaultTimeout } from "bun:test"
import { AbsolutePath, OpenCode, Session } from "@opencode/client/effect"
import { Permission } from "@opencode/schema/permission"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import { Effect, Layer, Option, Predicate, Queue, Stream, Struct } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeEvents } from "../src/harness/opencode/events.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { TestSettings } from "./lib/settings.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

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
  } = {},
) {
  const state = { layers: initial }
  const access = Struct.evolve(Shared.access(undefined, stub.url), {
    endpoints: (endpoints) =>
      endpoints.map((endpoint) =>
        Struct.evolve(endpoint, {
          models: (models) => models.map((model) => Struct.assign(model, { variants: [{ id: "high" }] })),
        }),
      ),
  })
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-settings-"))))
  const server = yield* OpenCodeServer.make(
    createEmbeddedRoutes({
      database: { path: options.database ?? ":memory:" },
      config: { project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    }).pipe(Layer.provide(HttpServer.layerServices)),
    access.endpoints,
    () => Effect.succeedNone,
    Option.none(),
    Option.some({ read: () => Effect.sync(() => state.layers) }),
  )
  const harness = yield* OpenCodeHarness.make(server, access.endpoints, AbsolutePath.make(directory))
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
  return { state, server, harness, client, sessionId, sessionID, turn }
})

describe("settings in the cell", () => {
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
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ren-settings-reopen-")))
      const database = join(directory, "opencode.db")
      const sessionId = RenSession.ID.create()
      const sessionID = Session.ID.make(sessionId)
      const layers = TestSettings.layers({
        ren: { permissions: [{ action: "subagent", resource: "explore", effect: "ask" }] },
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* open(layers, { database, sessionId, interactive: false })
          yield* first.harness.setModel(sessionId, Option.some({ endpointId: "stub", modelId: "stub-other" }))
        }),
      )
      const opened = yield* open(layers, { database, sessionId, start: false })
      opened.state.layers = TestSettings.layers({
        ren: {
          instructions: "Pulled after reopening.",
          permissions: [{ action: "subagent", resource: "explore", effect: "ask" }],
        },
      })
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
      const agents = (yield* opened.client.agent.list().pipe(Effect.orDie)).data
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

  it.live("the layers' instructions reach the model, and an edit applies at the next prompt", () =>
    Effect.gen(function* () {
      const opened = yield* open(TestSettings.layers({ ren: { instructions: "House rules." } }))
      const first = stub.script()
      yield* opened.turn(first)
      expect(first.calls[0]?.system).toContain("House rules.")
      opened.state.layers = TestSettings.layers({ ren: { instructions: "New rules." } })
      const second = stub.script()
      yield* opened.turn(second)
      expect(second.calls[0]?.system).toContain("New rules.")
      expect(second.calls[0]?.system).not.toContain("House rules.")
    }),
  )

  it.live("the layers' references reach the model as git references", () =>
    Effect.gen(function* () {
      const docs = {
        alias: "docs",
        repository: "https://git.example.invalid/acme/docs.git",
        branch: "main",
        description: "Product docs",
      }
      const opened = yield* open(TestSettings.layers({ ren: { references: [docs] } }))
      const first = stub.script()
      yield* opened.turn(first)
      expect(JSON.stringify(first.calls[0]?.body)).toContain("Product docs")
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
        opened.state.layers = asking("deny")
        const third = stub.script(fetchOnce("third"))
        yield* send(third)
        expect((yield* until(["permission.asked", "session.execution.succeeded"])).type).toBe(
          "session.execution.succeeded",
        )
        expect(JSON.stringify(third.calls.at(-1)?.body.messages.at(-1))).toContain("Permission denied")
      }),
  )
})
