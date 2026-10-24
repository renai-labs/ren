import { expect, setDefaultTimeout } from "bun:test"
import { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import { SessionID } from "@opencode/schema/session-id"
import { testEffect } from "@ren/executor/testing"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Layer, Queue } from "effect"
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

it.live("an installed app's remote MCP is a tool the model calls, follows a new release and goes on removal", () =>
  Effect.gen(function* () {
    const first = yield* McpPeer.make()
    const second = yield* McpPeer.make()
    const keyed = yield* McpPeer.make()
    yield* second.change("replacement")
    const test = yield* observed()
    yield* test.brain.configureApps(
      McpPeer.catalog("first", [
        { slug: "docs", url: first.url },
        { slug: "keyed", url: keyed.url, auth: { type: "header", name: "Authorization", credential: "token" } },
      ]),
    )
    const script = McpPeer.execute("docs.marker")
    yield* test.prompt(`${script.marker} read the marker`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(script)).toBe("first")
    expect(script.calls.at(0)?.system).not.toContain("tools.keyed")
    expect(Queue.sizeUnsafe(keyed.requests)).toBe(0)
    expect((yield* Queue.clear(first.requests)).filter((request) => request.method === "initialize")).toHaveLength(1)

    yield* test.brain.configureApps(McpPeer.catalog("second", [{ slug: "docs", url: second.url }]))
    const next = McpPeer.execute("docs.marker")
    yield* test.prompt(`${next.marker} read the marker again`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(next)).toBe("replacement")
    expect(JSON.stringify(next.calls.at(0)?.body.messages)).toContain(script.marker)

    yield* test.brain.configureApps(McpPeer.catalog("third", []))
    const removed = McpPeer.execute("docs.marker")
    yield* test.prompt(`${removed.marker} read the marker after removal`)
    yield* test.brain.opencode.session.wait({ sessionID: test.sessionID })
    expect(McpPeer.result(removed)).toContain("Unknown tool 'docs.marker'")
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
