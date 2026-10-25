import { expect, setDefaultTimeout } from "bun:test"
import { Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
import { HostMcp } from "@ren/host-api/host-mcp"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Effect, Layer, Option, Ref } from "effect"
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
  options: { readonly database?: string; readonly directory?: string } = {},
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
    },
  )
  const harness = yield* OpenCodeHarness.make(server, access.endpoints)
  const wait = (sessionId: RenSession.ID) =>
    server.client.session.wait({ sessionID: Session.ID.make(sessionId) }).pipe(Effect.orDie)
  const call = Effect.fnUntraced(function* (sessionId: RenSession.ID, sender: Option.Option<string>) {
    const script = McpPeer.execute("ren.marker")
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
            sender: { userId },
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
  return { call, chat, directory }
})

const renAt = Effect.fnUntraced(function* (token = "host-1") {
  const peer = yield* McpPeer.make()
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

it.live("a new host token reaches Ren at the next prompt", () =>
  Effect.gen(function* () {
    const ren = yield* renAt()
    const opened = yield* open(Option.some(ren.ren))
    const sessionId = yield* opened.chat()
    yield* opened.call(sessionId, Option.some("usr_ada"))
    yield* Ref.set(ren.current, Option.some("host-2"))
    yield* opened.call(sessionId, Option.some("usr_ada"))
    expect(ren.last(sessionId)?.get("authorization")).toBe("Bearer host-2")
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

it.live("a brain without Ren has no ren server", () =>
  Effect.gen(function* () {
    const opened = yield* open(Option.none())
    const sessionId = yield* opened.chat()
    expect(yield* opened.call(sessionId, Option.some("usr_ada"))).toContain("Unknown tool 'ren.marker'")
  }),
)
