import { expect, setDefaultTimeout } from "bun:test"
import { Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
import { HostMcp } from "@ren/host-api/host-mcp"
import { App } from "@ren/schema/app"
import { Auth } from "@ren/schema/auth"
import type { AppCatalog } from "@ren/schema/app-catalog"
import type { Channel } from "@ren/schema/channel"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Effect, Layer, Option, Ref } from "effect"
import { Base64Url } from "effect/encoding"
import { HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeMcp } from "../src/harness/opencode/mcp.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { McpPeer } from "./lib/mcp.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const open = Effect.fnUntraced(function* (
  ren: Option.Option<OpenCodeMcp.RenAccess>,
  options: {
    readonly database?: string
    readonly directory?: string
    readonly channels?: ReadonlyArray<Channel.Provider>
    readonly apps?: AppCatalog.Info
  } = {},
) {
  const access = Shared.access(undefined, stub.url)
  const directory =
    options.directory ?? (yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-mcp-")))))
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
    () => Effect.succeedNone,
    Option.none(),
    {
      saved: Option.none(),
      directoryOf: (sessionId) => join(directory, sessionId),
      makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
      ren,
      ...(options.channels && { channels: options.channels }),
      ...(options.apps && { apps: Option.some(options.apps) }),
    },
  )
  const harness = yield* OpenCodeHarness.make(server, access.endpoints)
  const wait = (sessionId: RenSession.ID) =>
    server.client.session.wait({ sessionID: Session.ID.make(sessionId) }).pipe(Effect.orDie)
  const call = Effect.fnUntraced(function* (
    sessionId: RenSession.ID,
    sender: Option.Option<string>,
    options: { readonly tool?: string; readonly memberId?: typeof Auth.MemberID.Type } = {},
  ) {
    const script = McpPeer.execute(options.tool ?? "ren.marker")
    const text = `${script.marker} read the marker`
    yield* Option.match(sender, {
      onNone: () =>
        server.client.session.prompt({ sessionID: Session.ID.make(sessionId), text }).pipe(Effect.orDie, Effect.asVoid),
      onSome: (userId) =>
        harness
          .send({
            sessionId,
            messageId: RenSession.MessageID.create(),
            prompt: { text },
            delivery: "steer",
            sender: { userId, ...(options.memberId && { memberId: options.memberId }) },
          })
          .pipe(Effect.asVoid),
    })
    yield* wait(sessionId)
    return McpPeer.result(script)
  })
  const chat = Effect.fnUntraced(function* (sessionId: RenSession.ID = RenSession.ID.create()) {
    yield* harness.start({ sessionId, harness: "opencode", interactive: true })
    return sessionId
  })
  const prompt = Effect.fnUntraced(function* (sessionId: RenSession.ID, text: string) {
    yield* server.client.session.prompt({ sessionID: Session.ID.make(sessionId), text }).pipe(Effect.orDie)
    yield* wait(sessionId)
  })
  return { call, chat, directory, prompt }
})

const renAt = Effect.fnUntraced(function* (token = "host-1", tools: ReadonlyArray<string> = []) {
  const peer = yield* McpPeer.make({ tools })
  const current = yield* Ref.make(Option.some(token))
  const ren: OpenCodeMcp.RenAccess = { address: Effect.succeed(Option.some(peer.url)), token: Ref.get(current) }
  const last = (sessionId: string) =>
    peer.headers.findLast((headers) => headers.get(HostMcp.sessionHeader) === sessionId)
  return { peer, current, ren, last }
})

it.live("each chat calls Ren MCP with the host token, its own chat and the sender of its latest prompt", () =>
  Effect.gen(function* () {
    const ren = yield* renAt()
    const opened = yield* open(Option.some(ren.ren))
    const ada = yield* opened.chat()
    const grace = yield* opened.chat()
    expect(yield* opened.call(ada, Option.some("usr_ada"))).toBe("first")
    expect(yield* opened.call(grace, Option.some("usr_grace"))).toBe("first")
    expect(
      [ada, grace].map((sessionId) => [
        ren.last(sessionId)?.get("authorization"),
        ren.last(sessionId)?.get(HostMcp.userHeader),
      ]),
    ).toEqual([
      ["Bearer host-1", "usr_ada"],
      ["Bearer host-1", "usr_grace"],
    ])
  }),
)

it.live("a prompt from another member calls Ren as that member; a prompt with no sender keeps the last sender", () =>
  Effect.gen(function* () {
    const ren = yield* renAt()
    const opened = yield* open(Option.some(ren.ren))
    const sessionId = yield* opened.chat()
    yield* opened.call(sessionId, Option.some("usr_ada"))
    yield* opened.call(sessionId, Option.some("usr_grace"))
    expect(ren.last(sessionId)?.get(HostMcp.userHeader)).toBe("usr_grace")
    expect(yield* opened.call(sessionId, Option.none())).toBe("first")
    expect(ren.last(sessionId)?.get(HostMcp.userHeader)).toBe("usr_grace")
  }),
)

const expiring = (name: string, minutes: number) =>
  `head.${Base64Url.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + minutes * 60 }))}.${name}`

it.live("a new host token reaches Ren at the next prompt once the token in use is near its expiry", () =>
  Effect.gen(function* () {
    const ren = yield* renAt(expiring("aging", 30))
    const opened = yield* open(Option.some(ren.ren))
    const sessionId = yield* opened.chat()
    yield* opened.call(sessionId, Option.some("usr_ada"))
    const replacement = expiring("replacement", 120)
    yield* Ref.set(ren.current, Option.some(replacement))
    yield* opened.call(sessionId, Option.some("usr_ada"))
    expect(ren.last(sessionId)?.get("authorization")).toBe(`Bearer ${replacement}`)
  }),
)

it.live("a newer host token leaves the Ren and channel servers connected while the token they use is valid", () =>
  Effect.gen(function* () {
    const fresh = expiring("fresh", 120)
    const ren = yield* renAt(fresh)
    const opened = yield* open(Option.some(ren.ren))
    const sessionId = yield* opened.chat()
    yield* opened.call(sessionId, Option.some("usr_ada"))
    yield* Ref.set(ren.current, Option.some(expiring("newer", 121)))
    yield* opened.call(sessionId, Option.some("usr_ada"))
    expect(ren.last(sessionId)?.get("authorization")).toBe(`Bearer ${fresh}`)
  }),
)

it.live("after a restart, a prompt with no sender calls Ren as the sender of the chat's latest message", () =>
  Effect.gen(function* () {
    const ren = yield* renAt()
    const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-mcp-reopen-"))))
    const database = join(directory, "opencode.db")
    const sessionId = RenSession.ID.create()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* open(Option.some(ren.ren), { database, directory })
        yield* first.chat(sessionId)
        yield* first.call(sessionId, Option.some("usr_grace"))
      }),
    )
    const reopened = yield* open(Option.some(ren.ren), { database, directory })
    const before = ren.peer.headers.length
    expect(yield* reopened.call(sessionId, Option.none())).toBe("first")
    expect(ren.peer.headers.slice(before).at(-1)?.get(HostMcp.userHeader)).toBe("usr_grace")
  }),
)

it.live(
  "a managed server is called with the integrations placeholder, its chat and the sender as a person placeholder",
  () =>
    Effect.gen(function* () {
      const ren = yield* renAt()
      const kernel = yield* McpPeer.make()
      const apps: AppCatalog.Info = {
        fingerprint: "managed",
        catalog: {
          apps: [],
          skills: [],
          unavailable: [],
          mcps: [
            {
              appId: App.ID.create(),
              appSlug: "kernel",
              slug: "browsers",
              server: "browsers",
              profile: null,
              label: "INTEGRATIONS",
              url: kernel.url,
              declaration: {
                name: "Kernel",
                description: "Cloud browsers",
                transport: { type: "managed", server: "kernel" },
                auth: { type: "none" },
                requiredCredentials: [],
              },
            },
          ],
        },
      }
      const opened = yield* open(Option.some(ren.ren), { apps })
      const sessionId = yield* opened.chat()
      const tool = "browsers.marker"
      expect(
        yield* opened.call(sessionId, Option.some("usr_ada"), { tool, memberId: Auth.MemberID.make("mem_ada") }),
      ).toBe("first")
      const ada = kernel.headers.at(-1)
      yield* opened.call(sessionId, Option.some("usr_grace"), { tool, memberId: Auth.MemberID.make("mem_grace") })
      expect(
        [ada, kernel.headers.at(-1)].map((headers) => [
          headers?.get("authorization"),
          headers?.get("ren-root-session"),
          headers?.get("ren-member"),
        ]),
      ).toEqual([
        ["Bearer ren:INTEGRATIONS", sessionId, "ren:PERSON.mem_ada"],
        ["Bearer ren:INTEGRATIONS", sessionId, "ren:PERSON.mem_grace"],
      ])
    }),
)

it.live("a brain without Ren has no ren server", () =>
  Effect.gen(function* () {
    const opened = yield* open(Option.none())
    const sessionId = yield* opened.chat()
    expect(yield* opened.call(sessionId, Option.some("usr_ada"))).toContain("Unknown tool 'ren.marker'")
  }),
)

it.live(
  "a space with Slack gets the slack server with its chat and no sender; its reply is a tool of its own that a subagent cannot call",
  () =>
    Effect.gen(function* () {
      const ren = yield* renAt("host-1", ["reply_to_current_thread"])
      const opened = yield* open(Option.some(ren.ren), { channels: ["slack"] })
      const sessionId = yield* opened.chat()
      yield* opened.call(sessionId, Option.some("usr_ada"))
      const reply = "slack_reply_to_current_thread"
      const root = stub.script({ tools: [{ name: reply, input: { text: "Rolled back." } }] })
      yield* opened.prompt(sessionId, `${root.marker} reply`)
      expect((yield* Effect.promise(() => root.called(1))).tools).toContain(reply)
      const called = ren.peer.paths.lastIndexOf(HostMcp.channelPath("slack"))
      expect(ren.peer.calls.at(-1)).toBe("reply_to_current_thread")
      expect([
        ren.peer.headers[called]?.get(HostMcp.sessionHeader),
        ren.peer.headers[called]?.get(HostMcp.userHeader),
      ]).toEqual([sessionId, null])
      const child = stub.script({ tools: [{ name: reply, input: { text: "From a helper." } }] })
      yield* opened.prompt(
        sessionId,
        `${stub.script({ tool: { name: "subagent", input: { agent: "general", description: "Help", prompt: `${child.marker} help` } } }).marker} delegate`,
      )
      const refused = (yield* Effect.promise(() => child.called(2))).body.messages.findLast(
        (message) => message.role === "tool",
      )?.content
      expect(JSON.stringify(refused)).toContain("Only the main agent posts in the channel.")
      expect(ren.peer.calls.filter((name) => name === "reply_to_current_thread")).toHaveLength(1)
    }),
)
