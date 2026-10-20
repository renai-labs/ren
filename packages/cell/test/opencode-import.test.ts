import { Database } from "bun:sqlite"
import { expect, setDefaultTimeout } from "bun:test"
import { AbsolutePath, OpenCode, type OpenCodeClient } from "@opencode/client/effect"
import { Location } from "@opencode/schema/location"
import { SessionID } from "@opencode/schema/session-id"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { TestAccess } from "@ren/brain/testing"
import { Sync } from "@ren/schema/sync"
import { testEffect } from "@ren/executor/testing"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../src/env.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"
import { BrainTest } from "./lib/brain.js"
import { OpenCodeRows } from "../src/harness/opencode/opencode-rows.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(30_000)

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const Stored = Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String, seq: Schema.Int }))

const all = (database: string, sql: string, ...params: ReadonlyArray<string>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => new Database(database, { readonly: true })),
    (db) => Effect.sync(() => db.query(sql).all(...params)),
    (db) => Effect.sync(() => db.close()),
  )

const stored = (database: string, sessionID: string) =>
  all(database, "select id, type, seq from session_message where session_id = ? order by seq, id", sessionID).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Stored)),
  )

const exported = Effect.fnUntraced(function* (database: string, sessionID: string) {
  const row = (yield* all(database, "select * from session_v2 where id = ?", sessionID)).at(0)
  const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Sync.OpenCodeMessageRow))(
    yield* all(
      database,
      "select id, session_id, type, seq, data from session_message where session_id = ? order by seq, id",
      sessionID,
    ),
  )
  return {
    info: OpenCodeRows.session(row),
    messages: yield* Effect.forEach(rows, OpenCodeRows.message),
  }
})

const folder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "ren-import-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

const open = Effect.fnUntraced(function* (id?: Session.ID) {
  const database = join(yield* folder, "opencode.db")
  return { ...(yield* BrainTest.make({ database, ...(id && { id }) })), database }
})

const turn = Effect.fnUntraced(function* (brain: Effect.Success<ReturnType<typeof open>>, text: string) {
  yield* brain.send(text)
  yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
})

const delegated = Effect.gen(function* () {
  const source = yield* open()
  yield* source.start()
  const answer = `child found ${crypto.randomUUID()}`
  const child = stub.script({ reply: answer })
  const parent = stub.script({
    tool: { name: "subagent", input: { agent: "general", description: "Look", prompt: `${child.marker} look` } },
  })
  yield* turn(source, `${parent.marker} delegate`)
  const children = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: SessionID })))(
    yield* all(source.database, "select id from session_v2 where parent_id = ?", source.id),
  )
  expect(children).toHaveLength(1)
  return { source, parent, answer, childID: (yield* Effect.fromNullishOr(children.at(0))).id }
})

const importOf = (client: OpenCodeClient, data: Effect.Success<ReturnType<typeof exported>>) =>
  client.session.import({ info: data.info, messages: data.messages, location: data.info.location })

it.live("an import beside another session in the same directory shares its project and leaves it unchanged", () =>
  Effect.gen(function* () {
    const source = yield* open()
    yield* source.start()
    yield* turn(source, `${stub.script().marker} first`)
    const data = yield* exported(source.database, source.id)
    const target = yield* open(source.id)
    const other = yield* target.opencode.session.create({ location: { directory: data.info.location.directory } })
    yield* target.opencode.session.prompt({ sessionID: other.id, text: `${stub.script().marker} other` })
    yield* target.opencode.session.wait({ sessionID: other.id })
    const snapshot = Effect.all([
      all(target.database, "select * from project order by id"),
      all(target.database, "select * from session_v2 where id = ?", other.id),
      all(target.database, "select * from session_message where session_id = ? order by seq", other.id),
    ])
    const before = yield* snapshot
    expect((yield* importOf(target.opencode, data)).projectID).toBe(other.projectID)
    expect(yield* snapshot).toEqual(before)
  }),
)

it.live("a child imported before its parent fails with Session.NotFoundError", () =>
  Effect.gen(function* () {
    const tree = yield* delegated
    const target = yield* open(tree.source.id)
    expect(
      yield* importOf(target.opencode, yield* exported(tree.source.database, tree.childID)).pipe(Effect.flip),
    ).toMatchObject({ _tag: "SessionNotFoundError", sessionID: tree.source.id })
  }),
)

it.live("a second import of the same session fails with ImportConflictError", () =>
  Effect.gen(function* () {
    const source = yield* open()
    yield* source.start()
    yield* turn(source, `${stub.script().marker} first`)
    const data = yield* exported(source.database, source.id)
    const target = yield* open(source.id)
    yield* importOf(target.opencode, data)
    expect(yield* importOf(target.opencode, data).pipe(Effect.flip)).toMatchObject({
      _tag: "ConflictError",
      resource: source.id,
    })
  }),
)

it.live("import drops an unsettled assistant message and a running shell and numbers the rest from 1", () =>
  Effect.gen(function* () {
    const source = yield* open()
    yield* source.start()
    const sessionID = SessionID.make(source.id)
    yield* turn(source, `${stub.script().marker} first`)
    const held = stub.script({ hold: true })
    yield* source.send(`${held.marker} second`)
    yield* Effect.promise(() => held.called())
    const pipes = yield* folder
    const started = join(pipes, "started")
    const finish = join(pipes, "finish")
    Bun.spawnSync(["mkfifo", started, finish])
    yield* source.opencode.session
      .shell({ sessionID, command: `printf started > ${started}; cat ${finish}` })
      .pipe(Effect.forkScoped)
    yield* Effect.promise(() => readFile(started))
    const data = yield* exported(source.database, source.id)
    yield* Effect.promise(() => writeFile(finish, ""))
    held.release()
    const unsettled = data.messages.filter(
      (message) =>
        (message.type === "assistant" && message.time.completed === undefined) ||
        (message.type === "shell" && message.status === "running"),
    )
    expect(unsettled.map((message) => message.type).toSorted()).toEqual(["assistant", "shell"])
    const target = yield* open(source.id)
    yield* importOf(target.opencode, data)
    const imported = yield* stored(target.database, source.id)
    const kept = data.messages.filter((message) => !unsettled.includes(message))
    expect(imported).toEqual(kept.map((message, index) => ({ id: message.id, type: message.type, seq: index + 1 })))
    yield* turn(target, `${stub.script().marker} next`)
    const next = (yield* stored(target.database, source.id)).slice(imported.length)
    expect(next.map((row) => row.type)).toEqual(["user", "assistant", "idle"])
    expect(next.every((row) => row.seq > imported.length)).toBe(true)
  }),
)

const withWorkspaces = Effect.fnUntraced(function* () {
  const database = join(yield* folder, "opencode.db")
  const connections = yield* Layer.build(
    EnvironmentConnections.layer.pipe(Layer.provide(TestAccess.fixed(new Map())), Layer.provide(FetchHttpClient.layer)),
  ).pipe(Effect.map((context) => Context.get(context, EnvironmentConnections.Service)))
  const host = yield* OpenCodeServer.make(
    createEmbeddedRoutes(
      {
        database: { path: database },
        config: { project: false, content: Schema.decodeUnknownSync(Env.Vars)(Shared.vars(stub.url)).OPENCODE_CONFIG },
        models: { fetch: false },
        fs: { filewatcher: false, fff: false },
      },
      RenWorkspaceDriver.replacements(connections),
    ).pipe(Layer.provide(HttpServer.layerServices)),
    Shared.access(undefined, stub.url).endpoints,
    () => Effect.succeedNone,
    Option.some(connections),
  )
  const opencode = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          host.fetch(new Request(input instanceof Request ? input.url : String(input), init)),
        { preconnect: fetch.preconnect },
      ),
    ),
  )
  return { host, opencode, database }
})

it.live("the import route drops the workspace of a session, also after the host makes it with the ren provider", () =>
  Effect.gen(function* () {
    const id = Session.ID.create()
    const workspace = { id: RenWorkspaceDriver.workspaceId(id), provider: RenWorkspaceDriver.provider }
    const source = yield* withWorkspaces()
    const workspaceID = yield* source.host.workspaces.create(workspace)
    yield* source.host.sessions.create({
      id: SessionID.make(id),
      location: Location.Ref.make({ directory: AbsolutePath.make(yield* folder), workspaceID }),
    })
    const data = yield* exported(source.database, id)
    expect(data.info.location.workspaceID).toBe(workspaceID)
    const target = yield* withWorkspaces()
    expect(yield* target.host.workspaces.create(workspace)).toBe(workspaceID)
    yield* importOf(target.opencode, data)
    expect((yield* target.host.sessions.get(SessionID.make(id))).location).toEqual({
      directory: data.info.location.directory,
      workspaceID: undefined,
    })
    expect(yield* all(target.database, "select workspace_id from session_v2 where id = ?", id)).toEqual([
      { workspace_id: null },
    ])
  }),
)

it.live("a session imports with the ID of a session that the database deleted before", () =>
  Effect.gen(function* () {
    const source = yield* open()
    yield* source.start()
    yield* turn(source, `${stub.script().marker} first`)
    const data = yield* exported(source.database, source.id)
    const target = yield* open(source.id)
    yield* target.start()
    yield* turn(target, `${stub.script().marker} lost`)
    yield* target.opencode.session.remove({ sessionID: SessionID.make(source.id) })
    yield* importOf(target.opencode, data)
    yield* turn(target, `${stub.script().marker} next`)
    const rows = yield* stored(target.database, source.id)
    expect(rows.slice(0, data.messages.length).map((row) => row.id)).toEqual(data.messages.map((message) => message.id))
    expect(rows.slice(data.messages.length).map((row) => row.type)).toEqual(["user", "assistant", "idle"])
  }),
)

const roles = (call: StubModel.Call) =>
  call.body.messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      message.tool_calls
        ? { role: message.role, tools: message.tool_calls.map((tool) => tool.function.name) }
        : { role: message.role, content: message.content },
    )

it.live(
  "a parent with a tool call and its child import into an empty database with their message IDs, and the next turn sends the whole history",
  () =>
    Effect.gen(function* () {
      const tree = yield* delegated
      const target = yield* open(tree.source.id)
      yield* importOf(target.opencode, yield* exported(tree.source.database, tree.source.id))
      expect(yield* importOf(target.opencode, yield* exported(tree.source.database, tree.childID))).toMatchObject({
        id: tree.childID,
        parentID: tree.source.id,
      })
      const ids = (database: string, sessionID: string) =>
        stored(database, sessionID).pipe(Effect.map((rows) => rows.map((row) => row.id)))
      expect(yield* ids(target.database, tree.source.id)).toEqual(yield* ids(tree.source.database, tree.source.id))
      expect(yield* ids(target.database, tree.childID)).toEqual(yield* ids(tree.source.database, tree.childID))
      yield* target.start()
      const next = stub.script()
      yield* target.send(`${next.marker} next`)
      expect(roles(yield* Effect.promise(() => next.called()))).toEqual([
        { role: "user", content: `${tree.parent.marker} delegate` },
        { role: "assistant", tools: ["subagent"] },
        { role: "tool", content: expect.stringContaining(tree.answer) },
        { role: "assistant", content: "stub reply" },
        { role: "user", content: `${next.marker} next` },
      ])
    }),
)

it.live("the next turn after the import of a compacted session sends the summary and not the older messages", () =>
  Effect.gen(function* () {
    const source = yield* open()
    yield* source.start()
    const sessionID = SessionID.make(source.id)
    const summary = `## Objective\n- summary ${crypto.randomUUID()}`
    const first = stub.script({ reply: "first answer", summary })
    yield* turn(source, `${first.marker} first`)
    yield* source.opencode.session.compact({ sessionID })
    yield* source.opencode.session.wait({ sessionID })
    const data = yield* exported(source.database, source.id)
    expect(data.messages.filter((message) => message.type === "compaction")).toMatchObject([
      { status: "completed", summary },
    ])
    const target = yield* open(source.id)
    yield* importOf(target.opencode, data)
    const next = stub.script()
    yield* target.send(`${next.marker} next`)
    expect(roles(yield* Effect.promise(() => next.called()))).toEqual([
      { role: "user", content: expect.stringContaining(`<summary>\n${summary}\n</summary>`) },
      { role: "user", content: `${next.marker} next` },
    ])
  }),
)

it.live("an imported session has no staged revert and no fork lineage", () =>
  Effect.gen(function* () {
    const source = yield* open()
    yield* source.start()
    yield* turn(source, `${stub.script().marker} first`)
    yield* turn(source, `${stub.script().marker} second`)
    const fork = yield* source.opencode.session.fork({ sessionID: SessionID.make(source.id) })
    const last = yield* Effect.fromNullishOr(
      (yield* source.opencode.message.list({ sessionID: fork.id })).data.find((message) => message.type === "user"),
    )
    yield* source.opencode.session.revert.stage({ sessionID: fork.id, messageID: last.id })
    const data = yield* source.opencode.session.export({ sessionID: fork.id })
    expect(data.info).toMatchObject({ fork: { sessionID: source.id }, revert: { messageID: last.id } })
    const target = yield* open()
    const imported = yield* target.opencode.session.import({ ...data, location: data.info.location })
    expect([imported.fork, imported.revert]).toEqual([undefined, undefined])
    expect(
      yield* all(
        target.database,
        "select fork_session_id, fork_boundary, revert from session_v2 where id = ?",
        fork.id,
      ),
    ).toEqual([{ fork_session_id: null, fork_boundary: null, revert: null }])
    expect((yield* stored(target.database, fork.id)).map((row) => row.id)).toEqual(
      data.messages.map((message) => message.id),
    )
  }),
)
