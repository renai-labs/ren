import { describe, expect, setDefaultTimeout } from "bun:test"
import { AbsolutePath, OpenCode, Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session-settings"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { TestSettings } from "./lib/settings.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const open = Effect.fnUntraced(function* (initial: SessionSettings.Layers) {
  const state = { layers: initial }
  const access = Shared.access(undefined, stub.url)
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-settings-"))))
  const server = yield* OpenCodeServer.make(
    createEmbeddedRoutes({
      database: { path: ":memory:" },
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
  const sessionId = RenSession.ID.create()
  const sessionID = Session.ID.make(sessionId)
  yield* harness.start({ sessionId, harness: "opencode", interactive: true })
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
  return { state, harness, client, sessionId, sessionID, turn }
})

describe("settings in the cell", () => {
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
})
