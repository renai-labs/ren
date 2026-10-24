import { expect, setDefaultTimeout } from "bun:test"
import { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import { SessionID } from "@opencode/schema/session-id"
import { testEffect } from "@ren/executor/testing"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { SessionMessage } from "@ren/schema/session/message"
import { App } from "@ren/schema/app"
import { Clock, Effect, Fiber, Layer, Option, Queue } from "effect"
import { TestClock } from "effect/testing"
import { OpenCodeMcp } from "../src/harness/opencode/mcp.js"
import { BrainTest } from "./lib/brain.js"
import { McpPeer } from "./lib/mcp.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(20_000)

const it = testEffect(Layer.empty)

const observed = Effect.fnUntraced(function* (apps?: AppCatalog.Info) {
  const tools = yield* Queue.unbounded<ReadonlyArray<{ readonly id: string; readonly description: string }>>()
  const brain = yield* BrainTest.make({
    ...(apps && { apps }),
    plugin: Plugin.define({
      id: "tool-catalog",
      effect: (context) =>
        context.tool
          .transform((editor) => {
            Queue.offerUnsafe(
              tools,
              editor.list().map((tool) => ({ id: tool.id, description: tool.description })),
            )
          })
          .pipe(Effect.asVoid),
    }),
  })
  yield* brain.start()
  return {
    brain,
    sessionID: SessionID.make(brain.id),
    tools: (until: (tools: ReadonlyArray<{ readonly id: string; readonly description: string }>) => boolean) =>
      Queue.take(tools).pipe(Effect.repeat({ until })),
    prompt: (text: string) =>
      brain.chat.session["session.prompt"]({
        params: { sessionID: brain.id },
        payload: { id: SessionMessage.ID.create(), text, delivery: "steer" },
      }),
  }
})

it.live("two profiles of one app are two servers, each with its own placeholder; a no-auth MCP is one server", () =>
  Effect.gen(function* () {
    const acme = yield* McpPeer.make()
    const globex = yield* McpPeer.make()
    const docs = yield* McpPeer.make()
    yield* globex.change("globex")
    const test = yield* observed()
    const oauth = { type: "oauth", tokenEndpointAuth: "none" } as const
    yield* test.brain.configureApps(
      McpPeer.catalog(
        "first",
        [
          { slug: "gmail", url: acme.url, auth: oauth, profile: { slug: "acme", name: "Acme client" } },
          { slug: "gmail", url: globex.url, auth: oauth, profile: { slug: "globex", name: "Globex client" } },
          { slug: "docs", url: docs.url },
        ],
        { unavailable: [{ appSlug: "docs", mcp: "sheets", profile: "Acme client", reason: "provider" }] },
      ),
    )
    const script = McpPeer.execute("gmail__globex.marker")
    yield* test.prompt(`${script.marker} read the globex marker`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(script)).toBe("globex")
    const system = script.calls.at(0)?.system ?? ""
    for (const tool of ["gmail__acme.marker", "gmail__globex.marker", "docs.marker"])
      expect(system).toContain(`tools.${tool}()`)
    expect(system).toContain("The MCP server gmail__acme is Docs for the profile “Acme client”.")
    expect(system).toContain("sheets (Acme client) is unavailable: the provider is not set up on this Ren.")
    expect(acme.headers.at(0)?.get("authorization")).toBe("Bearer ren:MCP_GMAIL__ACME")
    expect(globex.headers.at(0)?.get("authorization")).toBe("Bearer ren:MCP_GMAIL__GLOBEX")
    expect(docs.headers.at(0)?.get("authorization")).toBeNull()

    yield* test.brain.configureApps(McpPeer.catalog("second", []))
    const removed = McpPeer.execute("gmail__acme.marker")
    yield* test.prompt(`${removed.marker} read the marker after removal`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(removed)).toContain("Unknown tool 'gmail__acme.marker'")
  }),
)

it.effect("a local entry runs with its declared env and the profile's placeholders; a header MCP sends its field", () =>
  Effect.sync(() => {
    const catalog = McpPeer.catalog("local", [
      {
        slug: "sheets",
        transport: { type: "local", command: ["sheets"], env: { MODE: "read" } },
        profile: { slug: "acme", name: "Acme client" },
        env: { SHEETS_KEY: "ren:SHEETS_KEY__ACME" },
      },
      {
        slug: "crm",
        url: "https://crm.example.com/mcp",
        auth: { type: "header", name: "X-Api-Key", credential: "apiKey" },
        profile: { slug: "acme", name: "Acme client" },
      },
    ])
    const rendered = OpenCodeMcp.servers(Option.some(catalog), { local: true })
    expect(rendered.map((server) => [server.name, server.config])).toMatchObject([
      ["sheets__acme", { type: "local", environment: { MODE: "read", SHEETS_KEY: "ren:SHEETS_KEY__ACME" } }],
      ["crm__acme", { type: "remote", headers: { "X-Api-Key": "ren:MCP_CRM__ACME.apiKey" } }],
    ])
    expect(OpenCodeMcp.servers(Option.some(catalog), { local: false }).map((server) => server.name)).toEqual([
      "crm__acme",
    ])
  }),
)

it.effect("the env note: one line per app with connected env items, in catalog order, the same bytes each time", () =>
  Effect.sync(() => {
    const catalog = McpPeer.catalog("env", [], {
      apps: [
        {
          appId: App.ID.create(),
          appSlug: "google",
          name: "Google",
          profiles: [
            {
              slug: "acme",
              name: "Acme client",
              kind: "shared",
              env: { GOOGLE_PROJECT_ID: "GOOGLE_PROJECT_ID__ACME" },
            },
            {
              slug: "globex",
              name: "Globex client",
              kind: "shared",
              env: { GOOGLE_PROJECT_ID: "GOOGLE_PROJECT_ID__GLOBEX" },
            },
          ],
        },
        {
          appId: App.ID.create(),
          appSlug: "docs",
          name: "Docs",
          profiles: [{ slug: "acme", name: "Acme", kind: "shared", env: {} }],
        },
      ],
    })
    const notes = OpenCodeMcp.notes(Option.some(catalog), { local: true })
    expect(notes).toEqual([
      "google profiles: Acme client → keys end in `__ACME` (`GOOGLE_PROJECT_ID__ACME`); Globex client → `__GLOBEX`. Env keys exist only with the suffix.",
    ])
    expect(OpenCodeMcp.notes(Option.some(catalog), { local: true }).join("\n")).toBe(notes.join("\n"))
  }),
)

it.effect("after a failure, retries come at 10 s, 1 min and 5 min, and stop once no server is down", () =>
  Effect.gen(function* () {
    const at: Array<number> = []
    const state = { down: true }
    const fiber = yield* OpenCodeMcp.retrying({
      down: Effect.sync(() => state.down),
      retry: Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.sync(() => at.push(now))),
    }).pipe(Effect.forkChild)
    yield* TestClock.adjust("10 seconds")
    yield* TestClock.adjust("1 minute")
    state.down = false
    yield* TestClock.adjust("5 minutes")
    yield* Fiber.join(fiber)
    expect(at).toEqual([10_000, 70_000])
  }),
)

it.live("a server whose connect got a 403 is connected again at the next turn; a connected server keeps running", () =>
  Effect.gen(function* () {
    const good = yield* McpPeer.make()
    const bad = yield* McpPeer.make()
    yield* bad.change("reconnected")
    yield* bad.refuse(403)
    const test = yield* observed()
    const oauth = { type: "oauth", tokenEndpointAuth: "none" } as const
    yield* test.brain.configureApps(
      McpPeer.catalog("first", [
        { slug: "good", url: good.url },
        { slug: "bad", url: bad.url, auth: oauth, profile: { slug: "acme", name: "Acme" } },
      ]),
    )
    const first = McpPeer.execute("good.marker")
    yield* test.prompt(`${first.marker} read the marker`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(first.calls.at(0)?.system).not.toContain("tools.bad__acme.marker()")
    yield* Queue.clear(good.requests)
    yield* bad.refuse(200)
    const second = McpPeer.execute("bad__acme.marker")
    yield* test.prompt(`${second.marker} read the marker again`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(second)).toBe("reconnected")
    expect((yield* Queue.clear(good.requests)).filter((request) => request.method === "initialize")).toEqual([])
  }),
)

it.live("an app server that cannot connect leaves the chat and another app's tools usable", () =>
  Effect.gen(function* () {
    const peer = yield* McpPeer.make()
    const test = yield* observed()
    yield* test.brain.configureApps(
      McpPeer.catalog("first", [
        { slug: "docs", url: peer.url },
        { slug: "broken", url: "http://127.0.0.1:1", timeouts: { startup: 500 } },
      ]),
    )
    const script = McpPeer.execute("docs.marker")
    yield* test.prompt(`${script.marker} read the marker`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(script)).toBe("first")
    const broken = McpPeer.execute("broken.marker")
    yield* test.prompt(`${broken.marker} read the broken marker`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(broken)).toContain("Unknown tool 'broken.marker'")
  }),
)

it.live("the first turn in a brain that opens with an installed app waits for the app's server to connect", () =>
  Effect.gen(function* () {
    const peer = yield* McpPeer.make({ holdInitialization: true })
    const test = yield* observed(McpPeer.catalog("first", [{ slug: "docs", url: peer.url }]))
    yield* Queue.take(peer.requests).pipe(Effect.repeat({ until: (request) => request.method === "initialize" }))
    const script = McpPeer.execute("docs.marker")
    yield* test.prompt(`${script.marker} read the marker`)
    peer.release()
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(script)).toBe("first")
  }),
)

it.live("two app MCPs at one URL stay distinct, list every tool page and follow the server's tool changes", () =>
  Effect.gen(function* () {
    const peer = yield* McpPeer.make()
    const test = yield* observed()
    yield* test.brain.configureApps(
      McpPeer.catalog("first", [
        { slug: "docs", url: peer.url },
        { slug: "shared", url: peer.url },
      ]),
    )
    const script = McpPeer.execute("shared.second")
    yield* test.prompt(`${script.marker} read the marker`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    for (const tool of ["docs.marker", "docs.second", "shared.marker", "shared.second"])
      expect(script.calls.at(0)?.system).toContain(`tools.${tool}()`)
    expect(McpPeer.result(script)).toBe("first")
    expect(script.calls.at(0)?.system).toContain("Use the test tools")

    yield* peer.listening.pipe(
      Effect.timeout("2 seconds"),
      Effect.mapError(() => new Error("No MCP notification stream")),
    )
    yield* Queue.clear(peer.requests)
    yield* peer.change("changed")
    yield* Queue.take(peer.requests).pipe(
      Effect.repeat({ until: (request) => request.method === "tools/list" }),
      Effect.timeout("2 seconds"),
      Effect.mapError(() => new Error("No tools list request after notification")),
    )
    yield* test.tools((all) => all.some((tool) => tool.id === "docs_marker" && tool.description === "changed"))
    const changed = Shared.stub().script()
    yield* test.prompt(`${changed.marker} check the tool list`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(JSON.stringify(changed.calls.at(0)?.body.messages)).toContain(
      "tools.docs.marker(): Promise&lt;unknown&gt; // changed",
    )
  }),
)

it.live(
  "a replacement waits for an actual MCP call and the next call uses the new connection in the same session",
  () =>
    Effect.gen(function* () {
      const first = yield* McpPeer.make({ hold: true })
      const second = yield* McpPeer.make({ holdInitialization: true })
      yield* second.change("replacement")
      const contexts = yield* Queue.unbounded<Plugin.Context>()
      const state = { url: first.url }
      const tools = yield* Queue.unbounded<{ readonly directory: string; readonly ids: ReadonlyArray<string> }>()
      const brain = yield* BrainTest.make({
        plugin: Plugin.define({
          id: "held-mcp-test",
          effect: (context) =>
            Effect.gen(function* () {
              yield* context.mcp.transform((editor) => {
                editor.set(
                  "docs",
                  new Mcp.RemoteConfig({ type: "remote", url: state.url, oauth: false, codemode: false }),
                )
              })
              yield* context.tool.transform((editor) => {
                Queue.offerUnsafe(tools, {
                  directory: context.location.directory,
                  ids: editor.list().map((tool) => tool.id),
                })
              })
              yield* Queue.offer(contexts, context)
            }),
        }),
      })
      yield* brain.start()
      const context = yield* Queue.take(contexts).pipe(
        Effect.repeat({ until: (context) => context.location.directory === brain.directory }),
      )
      const sessionID = SessionID.make(brain.id)
      yield* Queue.take(tools).pipe(
        Effect.repeat({
          until: (catalog) => catalog.directory === brain.directory && catalog.ids.includes("docs_marker"),
        }),
      )
      const held = Shared.stub().script({ tools: [{ name: "docs_marker", input: {} }] })
      yield* brain.send(`${held.marker} read the marker`)
      yield* Queue.take(first.requests).pipe(Effect.repeat({ until: (request) => request.method === "tools/call" }))
      state.url = second.url
      yield* brain.atBoundary(context.mcp.reload().pipe(Effect.orDie))
      expect(Queue.sizeUnsafe(second.requests)).toBe(0)
      first.release()
      yield* Queue.take(second.requests).pipe(Effect.repeat({ until: (request) => request.method === "initialize" }))
      const next = Shared.stub().script({ tools: [{ name: "docs_marker", input: {} }] })
      yield* brain.send(`${next.marker} read again`)
      expect(next.calls).toHaveLength(0)
      second.release()
      yield* brain.opencode.session.wait({ sessionID })
      expect(JSON.stringify(held.calls.at(-1)?.body.messages)).toContain("first")
      expect(JSON.stringify(next.calls.at(-1)?.body.messages)).toContain("replacement")
      expect(JSON.stringify(next.calls.at(0)?.body.messages)).toContain(held.marker)
    }),
)
