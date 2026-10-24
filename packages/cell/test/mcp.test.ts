import { expect, setDefaultTimeout } from "bun:test"
import { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import { SessionID } from "@opencode/schema/session-id"
import { testEffect } from "@ren/executor/testing"
import { Effect, Layer, Queue } from "effect"
import { BrainTest } from "./lib/brain.js"
import { McpPeer } from "./lib/mcp.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(20_000)

const it = testEffect(Layer.empty)

it.live("MCP transforms discover all tool pages, refresh live tools and replace connections in the same session", () =>
  Effect.gen(function* () {
    const first = yield* McpPeer.make()
    const second = yield* McpPeer.make()
    yield* second.change("replacement")
    const contexts = yield* Queue.unbounded<Plugin.Context>()
    const catalogs = yield* Queue.unbounded<ReadonlyArray<{ readonly id: string; readonly description: string }>>()
    const state: { servers: ReadonlyArray<readonly [string, Mcp.RemoteConfig]> } = { servers: [] }
    const brain = yield* BrainTest.make({
      plugin: Plugin.define({
        id: "mcp-test",
        effect: (context) =>
          Effect.gen(function* () {
            yield* context.mcp.transform((editor) => {
              for (const entry of state.servers) editor.set(entry[0], entry[1])
            })
            yield* context.tool.transform((editor) => {
              Queue.offerUnsafe(
                catalogs,
                editor.list().map((tool) => ({ id: tool.id, description: tool.description })),
              )
            })
            yield* Queue.offer(contexts, context)
          }),
      }),
    })
    yield* brain.start()
    yield* brain.opencode.mcp.list({ location: { directory: brain.directory } })
    const context = yield* Queue.take(contexts).pipe(
      Effect.repeat({ until: (context) => context.location.directory === brain.directory }),
    )
    const ready = (names: ReadonlyArray<string>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const listed = yield* context.mcp.list().pipe(Effect.orDie)
        expect(listed.data.map((server) => ({ name: server.name, status: server.status.status }))).toEqual(
          names.map((name) => ({ name, status: "connected" })),
        )
      })
    state.servers = ["docs", "shared"].map((name) => [
      name,
      new Mcp.RemoteConfig({
        type: "remote",
        url: first.url,
        oauth: false,
        codemode: false,
      }),
    ])
    yield* context.mcp.reload()
    yield* Queue.take(catalogs).pipe(
      Effect.repeat({ until: (tools) => tools.some((tool) => tool.id === "shared_second") }),
    )
    yield* ready(["docs", "shared"])
    const sessionID = SessionID.make(brain.id)
    const script = Shared.stub().script({ tools: [{ name: "docs_marker", input: {} }] })
    yield* brain.send(`${script.marker} read the marker`)
    yield* brain.opencode.session.wait({ sessionID })
    expect(script.calls.at(0)?.tools).toEqual(
      expect.arrayContaining(["docs_marker", "docs_second", "shared_marker", "shared_second"]),
    )
    expect(
      script.calls
        .at(-1)
        ?.body.messages.some((message) => message.role === "tool" && JSON.stringify(message.content).includes("first")),
    ).toBe(true)
    expect(script.calls.at(0)?.system).toContain("Use the test tools")

    yield* first.listening.pipe(
      Effect.timeout("2 seconds"),
      Effect.mapError(() => new Error("No MCP notification stream")),
    )
    yield* Queue.clear(first.requests)
    yield* first.change("changed")
    yield* Queue.take(first.requests).pipe(
      Effect.repeat({ until: (request) => request.method === "tools/list" }),
      Effect.timeout("2 seconds"),
      Effect.mapError(() => new Error("No tools list request after notification")),
    )
    yield* Queue.take(catalogs).pipe(
      Effect.repeat({
        until: (tools) => tools.some((tool) => tool.id === "docs_marker" && tool.description === "changed"),
      }),
      Effect.timeout("2 seconds"),
      Effect.mapError(() => new Error("No changed tool transform")),
    )
    const changed = Shared.stub().script()
    yield* brain.send(`${changed.marker} check the tool list`)
    yield* brain.opencode.session.wait({ sessionID })
    expect(
      changed.calls.at(0)?.body.tools?.find((tool) => tool.function.name === "docs_marker")?.function.description,
    ).toBe("changed")

    state.servers = [
      [
        "docs",
        new Mcp.RemoteConfig({
          type: "remote",
          url: second.url,
          oauth: false,
          codemode: false,
        }),
      ],
    ]
    yield* context.mcp.reload()
    yield* Queue.take(catalogs).pipe(
      Effect.repeat({
        until: (tools) =>
          tools.some((tool) => tool.id === "docs_marker" && tool.description === "replacement") &&
          !tools.some((tool) => tool.id.startsWith("shared_")),
      }),
    )
    yield* ready(["docs"])
    const next = Shared.stub().script({ tools: [{ name: "docs_marker", input: {} }] })
    yield* brain.send(`${next.marker} read the marker again`)
    yield* brain.opencode.session.wait({ sessionID })
    expect(
      next.calls
        .at(-1)
        ?.body.messages.some(
          (message) => message.role === "tool" && JSON.stringify(message.content).includes("replacement"),
        ),
    ).toBe(true)
    expect(JSON.stringify(next.calls.at(0)?.body.messages)).toContain(script.marker)

    state.servers = []
    yield* context.mcp.reload()
    yield* Queue.take(catalogs).pipe(
      Effect.repeat({ until: (tools) => !tools.some((tool) => tool.id.startsWith("docs_")) }),
    )
    yield* ready([])
    const removed = Shared.stub().script()
    yield* brain.send(`${removed.marker} check removal`)
    yield* brain.opencode.session.wait({ sessionID })
    expect(removed.calls.at(0)?.tools.some((name) => name.startsWith("docs_") || name.startsWith("shared_"))).toBe(
      false,
    )
  }),
)
