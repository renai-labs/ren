import { describe, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { OpenCodeSync } from "@ren/opencode-transcript/opencode-sync"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import { SqliteReader } from "@ren/opencode-transcript/sqlite-reader"
import { OpenCodeFixtures } from "@ren/opencode-transcript/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import { Sync } from "@ren/schema/sync"
import { Shared, type StubModel, SyncClient } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Seed } from "@ren/core/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import type { Session as RenSession } from "@ren/schema/session"
import { Clock, Deferred, Duration, Effect, Fiber, Layer, Logger, Metric, References, Schema, Stream } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { TestClock } from "effect/testing"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hostToken } from "./lib/app.js"
import { Proxy } from "./lib/proxy.js"
import { SyncTest } from "./lib/sync.js"

const it = { live: SyncTest.live }

const stub = Shared.stub()

const folder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "opencode-sync-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

const tokenFor = Effect.fnUntraced(function* (sid: RenSession.ID, org: Auth.OrganizationID, seconds: number) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  return yield* hostToken(Brain.ofSession(sid), org, { exp: now + seconds })
})

const sessionColumns = Object.keys(Sync.OpenCodeSessionRow.fields).join(", ")

const messageColumns = Object.keys(Sync.OpenCodeMessageRow.fields).join(", ")

const local = (db: Database, root: RenSession.ID) => {
  const sessions = Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeSessionRow))(
    db.query(`select ${sessionColumns} from session_v2`).all(),
  )
  const parents = new Map(sessions.map((session) => [session.id, session.parent_id]))
  const rootOf = (id: RenSession.ID): RenSession.ID => {
    const parent = parents.get(id)
    return parent ? rootOf(parent) : id
  }
  const scoped = new Set(sessions.filter((session) => rootOf(session.id) === root).map((session) => session.id))
  return {
    sessions: SyncTest.sortRows(
      sessions.filter((session) => scoped.has(session.id)),
      (session) => session.id,
    ),
    messages: SyncTest.sortRows(
      Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeMessageRow))(
        db.query(`select ${messageColumns} from session_message`).all(),
      ).filter((message) => scoped.has(message.session_id)),
      SyncTest.messageKey,
    ),
  }
}

const paths = (requests: ReadonlyArray<Proxy.Request>) => requests.map((request) => request.path)

const checkpoints = "/host/sync/checkpoints"

const uploads = (id: string) => `/host/sync/sessions/${id}/uploads`

const isStart = (id: string) => (request: Proxy.Request) => request.path === uploads(id)

const isBatch = (id: string) => (request: Proxy.Request) =>
  request.path.startsWith(`${uploads(id)}/`) && request.path.endsWith("/messages")

const isCommit = (id: string) => (request: Proxy.Request) =>
  request.path.startsWith(`${uploads(id)}/`) && request.path.endsWith("/commit")

const nth = (count: number, match: (request: Proxy.Request) => boolean) => {
  const seen = { count: 0 }
  return (request: Proxy.Request) => match(request) && ++seen.count === count
}

const logs = () => {
  const messages: Array<string> = []
  const annotations: Array<Readonly<Record<string, unknown>>> = []
  return {
    messages,
    annotations,
    layer: Logger.layer([
      Logger.make((options) => {
        messages.push([options.message].flat().map(String).join(" "))
        annotations.push(options.fiber.getRef(References.CurrentLogAnnotations))
      }),
    ]),
  }
}

const renId = Schema.decodeUnknownSync(Sync.Checkpoint.fields.id)

const setup = Effect.fnUntraced(function* (input: { readonly id?: RenSession.ID; readonly isStarted?: boolean } = {}) {
  const file = join(yield* folder, "opencode.db")
  const brain = yield* SyncTest.isolated(BrainTest.make({ database: file, ...(input.id && { id: input.id }) }))
  if (input.isStarted ?? true) yield* brain.start({ interactive: false, title: "Sync" })
  const owner = yield* Seed.owner()
  yield* Seed.session(owner, { sessionId: brain.id })
  const server = yield* HttpServer.HttpServer
  const proxy = yield* Proxy.make(HttpServer.formatAddress(server.address))
  const token = { value: yield* tokenFor(brain.id, owner.organizationId, 600) }
  const host = { restoring: new Set<RenSession.ID>() }
  const db = new Database(file)
  yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
  const reader = yield* SqliteReader.make(file)
  const driver = brain.driver
  const root = brain.id
  const sync = (input: { readonly reader?: OpenCodeSync.Reader; readonly version?: string } = {}) =>
    SyncClient.make(
      proxy.url,
      Effect.sync(() => token.value),
    ).pipe(
      Effect.flatMap((remote) =>
        OpenCodeSync.make({
          remote,
          reader: input.reader ?? reader,
          version: input.version ?? "2.0.27",
          restoring: Effect.sync(() => new Set(host.restoring)),
          mark: (id, state) =>
            Effect.sync(() => void (state.isRestoring ? host.restoring.add(id) : host.restoring.delete(id))),
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
    )
  const create = (parentId?: RenSession.ID) => driver.create({ ...(parentId && { parentId }) })
  const turn = Effect.fnUntraced(function* (id: RenSession.ID, script: StubModel.Script = stub.script()) {
    yield* driver.prompt(id, `Go ${script.marker}`)
    yield* Effect.promise(() => script.called())
    yield* driver.wait(id)
  })
  const expectEqual = Effect.gen(function* () {
    const expected = local(db, brain.id)
    expect(yield* SyncTest.remote(brain.id)).toEqual(expected)
    return expected
  })
  return { brain, owner, root, proxy, token, host, db, reader, driver, sync, create, turn, expectEqual }
})

describe("OpenCodeSync", () => {
  it.live(
    "a long session with tool calls, a subagent, a retry, and a shell command is equal in SQLite and in Postgres",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        yield* host.turn(host.root)
        yield* host.turn(host.root, stub.script({ tool: { name: "skill", input: { name: "missing" } } }))
        const child = stub.script()
        yield* host.turn(
          host.root,
          stub.script({
            tool: {
              name: "subagent",
              input: { agent: "general", description: "Look", prompt: `${child.marker} look` },
            },
          }),
        )
        yield* Effect.promise(() => child.called())
        const retry = stub.script({ status: 503 })
        yield* host.driver.prompt(host.root, retry.marker)
        yield* Effect.promise(() => retry.called())
        retry.set({})
        yield* Effect.promise(() => retry.called(2))
        yield* host.driver.wait(host.root)
        yield* host.driver.shell(host.root, "echo shell")
        yield* host.driver.wait(host.root)
        expect(yield* sync.step()).toEqual({ drained: true })
        const synced = yield* host.expectEqual
        expect(synced.sessions).toHaveLength(2)
        expect(synced.messages.map((message) => message.type)).toEqual(
          expect.arrayContaining(["user", "assistant", "shell"]),
        )
      }),
    60_000,
  )

  it.live("a revert while sync is late marks the reverted messages removed in Postgres", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      yield* host.turn(host.root)
      yield* sync.step()
      const before = yield* host.expectEqual
      const second = before.messages.filter((message) => message.type === "user")[1]
      if (!second) return yield* Effect.die(new Error("The second user message is missing"))
      yield* host.driver.revert(host.root, second.id)
      yield* sync.step()
      const after = yield* host.expectEqual
      expect(after.messages.map((message) => message.id)).not.toContain(second.id)
    }),
  )

  it.live("a second step with no change sends no request except checkpoints", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      yield* sync.step()
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(paths(host.proxy.requests)).toEqual([checkpoints])
    }),
  )

  it.live("a claim that changes only time_suspended makes Ren show busy. A release makes Ren show idle", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      yield* sync.step()
      const suspend = (at: number | null) =>
        host.db.run("update session_v2 set time_suspended = ? where id = ?", [at, host.root])
      suspend(Date.now())
      yield* sync.step()
      expect(yield* SyncTest.status(host.root)).toBe("busy")
      suspend(null)
      yield* sync.step()
      expect(yield* SyncTest.status(host.root)).toBe("idle")
      yield* host.expectEqual
    }),
  )

  it.live(
    "a step that fails at the start of the upload, at a batch after the first, or at the commit, then runs again, gives an equal result",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        yield* host.turn(host.root)
        yield* host.turn(host.root, stub.script({ reply: "a".repeat(1_200_000) }))
        yield* host.turn(host.root)
        yield* sync.step()
        expect(host.proxy.requests.filter(isBatch(host.root)).length).toBeGreaterThanOrEqual(3)
        yield* Effect.forEach(
          [isStart(host.root), nth(2, isBatch(host.root)), isCommit(host.root)],
          (match, index) =>
            Effect.gen(function* () {
              yield* host.driver.rename(host.root, `Case ${index}`)
              host.proxy.once({ match, fault: "fail" })
              expect(yield* sync.step()).toEqual({ drained: false, failed: true })
              expect(yield* sync.step()).toEqual({ drained: true })
              yield* host.expectEqual
            }),
          { discard: true },
        )
      }),
    60_000,
  )

  it.live("Ren applies the commit, and the reply is lost. The next step does no pass", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      host.proxy.once({ match: isCommit(host.root), fault: "lose" })
      expect(yield* sync.step()).toEqual({ drained: false, failed: true })
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(paths(host.proxy.requests)).toEqual([checkpoints])
      yield* host.expectEqual
    }),
  )

  it.live(
    "a message that OpenCode writes between the read of E and the read of L is in Postgres after the next step",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        yield* host.turn(host.root)
        const written: { id: string | null } = { id: null }
        const columns = host.db
          .query<{ name: string }, []>("pragma table_info(session_message)")
          .all()
          .map((column) => column.name)
        const write = () => {
          const last = host.db
            .query<{ id: string; seq: number }, [string]>(
              "select id, seq from session_message where session_id = ? order by seq desc limit 1",
            )
            .get(host.root)
          if (!last) return
          const id = `msg_between_${last.seq}`
          const copied = columns.map((column) => (column === "id" || column === "seq" ? "?" : column)).join(", ")
          host.db.transaction(() => {
            host.db.run(
              `insert into session_message (${columns.join(", ")}) select ${copied} from session_message where id = ?`,
              [
                ...columns.flatMap((column): Array<string | number> => {
                  if (column === "id") return [id]
                  return column === "seq" ? [last.seq + 1] : []
                }),
                last.id,
              ],
            )
            host.db.run("update event_sequence set seq = ? where aggregate_id = ?", [last.seq + 1, host.root])
          })()
          written.id = id
        }
        const sync = yield* host.sync({
          reader: {
            read: (read) =>
              host.reader.read((query) =>
                read((sql, ...bindings) => {
                  const rows = [...query(sql, ...bindings)]
                  if (written.id === null && sql.startsWith("select seq from event_sequence")) write()
                  return rows
                }),
              ),
          },
        })
        yield* sync.step()
        const id = written.id
        if (id === null) return yield* Effect.die(new Error("The reader did not read E"))
        yield* sync.step()
        const synced = yield* host.expectEqual
        expect(synced.messages.map((message) => message.id)).toContain(id)
      }),
  )

  it.live("a title change during a pass is in Postgres after the next step", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      host.proxy.once({
        match: isCommit(host.root),
        before: () => Effect.runPromise(host.driver.rename(host.root, "Renamed during the pass")),
      })
      yield* sync.step()
      yield* sync.step()
      const synced = yield* host.expectEqual
      expect(synced.sessions.map((session) => session.title)).toEqual(["Renamed during the pass"])
    }),
  )

  it.live("a raw NUL in a title reaches Postgres as U+FFFD, and the pass commits", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.driver.rename(host.root, "a\u0000b")
      expect(yield* sync.step()).toEqual({ drained: true })
      expect((yield* SyncTest.remote(host.brain.id)).sessions.map((session) => session.title)).toEqual(["a\uFFFDb"])
    }),
  )

  it.live("restore reads every page of a session with more messages than one page, in transcript order", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      yield* host.turn(host.root)
      const columns = host.db
        .query<{ name: string }, []>("pragma table_info(session_message)")
        .all()
        .map((column) => column.name)
      const last = host.db
        .query<{ id: string; seq: number }, [string]>(
          "select id, seq from session_message where session_id = ? order by seq desc limit 1",
        )
        .get(host.root)
      if (!last) return yield* Effect.die(new Error("The turn wrote no message"))
      const copied = columns
        .map((column) => {
          if (column === "id") return "'msg_copy_' || printf('%04d', n)"
          return column === "seq" ? `${last.seq} + n` : column
        })
        .join(", ")
      host.db.transaction(() => {
        host.db.run(
          `insert into session_message (${columns.join(", ")}) with recursive copies(n) as (select 1 union all select n + 1 from copies where n < 1000) select ${copied} from session_message, copies where id = ?`,
          [last.id],
        )
        host.db.run("update event_sequence set seq = ? where aggregate_id = ?", [last.seq + 1000, host.root])
      })()
      const sync = yield* host.sync()
      expect(yield* sync.step()).toEqual({ drained: true })
      const expected = yield* host.expectEqual
      host.proxy.clear()
      const imported: Array<Sync.OpenCodeMessageRow> = []
      yield* sync.restore({
        sessionId: host.brain.id,
        exists: () => Effect.succeed(false),
        start: () => Effect.void,
        import: (data) => Effect.sync(() => imported.push(...data.messages)),
      })
      expect(imported.map((message) => message.id)).toEqual(expected.messages.map((message) => message.id))
      expect(
        host.proxy.requests.filter((request) => request.path === `/host/sync/sessions/${host.root}/messages`),
      ).toHaveLength(Math.floor(expected.messages.length / 500) + 1)
    }),
  )

  it.live(
    "after a turn, a subagent and a shell command, each OpenCode table with rows is one that sync reads or one that Ren keeps out on purpose",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const child = stub.script()
        yield* host.turn(
          host.root,
          stub.script({
            reasoning: "Planning",
            tool: {
              name: "subagent",
              input: { agent: "general", description: "Look", prompt: `${child.marker} look` },
            },
          }),
        )
        yield* host.driver.shell(host.root, "echo shell")
        yield* host.driver.wait(host.root)
        const known = new Set([
          "session_v2",
          "session_message",
          "session_inbox",
          "event_sequence",
          "migration",
          "project",
          "worktree",
          "instruction_blob",
          "instruction_state",
        ])
        const filled = host.db
          .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
          .all()
          .map((table) => table.name)
          .filter((name) => host.db.query(`select 1 from "${name}" limit 1`).get() !== null)
        expect(filled.filter((name) => !known.has(name))).toEqual([])
        const storage = [
          {
            name: "session_v2",
            synced: Object.keys(Sync.OpenCodeSessionRow.fields),
            omitted: {
              fork_session_id: "Import flattens forks",
              fork_boundary: "Import flattens forks",
              share_url: "OpenCode sharing is not exposed by Ren",
              summary_diffs: "Whole patches are not part of the saved transcript",
              revert: "Synced separately as revertMessageId",
              time_compacting: "In-flight compaction is restarted",
              time_busy: "When the running turn started belongs to the running host",
              resume_attempts: "Retry accounting belongs to the running host",
            },
          },
          {
            name: "session_message",
            synced: Object.keys(Sync.OpenCodeMessageRow.fields),
            omitted: {
              time_created: "Message times live in data",
              time_updated: "Message times live in data",
            },
          },
          { name: "session_inbox", synced: Object.keys(Sync.OpenCodeInboxRow.fields), omitted: {} },
          {
            name: "event_sequence",
            synced: ["aggregate_id", "seq"],
            omitted: { owner_id: "The new host owns the restored aggregate" },
          },
        ]
        for (const table of storage) {
          const actual = host.db
            .query<{ name: string }, []>(`pragma table_info(${table.name})`)
            .all()
            .map((column) => column.name)
            .toSorted()
          expect({ table: table.name, columns: actual }).toEqual({
            table: table.name,
            columns: [...table.synced, ...Object.keys(table.omitted)].toSorted(),
          })
        }
      }),
  )

  it.live("a commit records the OpenCode version that wrote the rows", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      yield* host.turn(host.root)
      const sync = yield* host.sync({ version: "2.10.0" })
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(yield* SyncTest.harnessVersion(host.root)).toBe("2.10.0")
    }),
  )

  describe.each(OpenCodeFixtures.recordings.map((recording) => [recording.version, recording] as const))(
    "chats recorded on OpenCode %s",
    (_, recording) => {
      const rootOf = (chat: OpenCodeFixtures.Chat): RenSession.ID => {
        const parent = recording.chats.find((each) => each.session.id === chat.session.parent_id)
        return parent ? rootOf(parent) : chat.session.id
      }
      const Compaction = Schema.fromJsonString(
        Schema.Struct({ summary: Schema.String, recent: Schema.optionalKey(Schema.String) }),
      )
      for (const root of recording.chats.filter((chat) => chat.session.parent_id === null))
        it.live(
          `chat ${root.session.id} comes back through sync and restore, runs a turn with its whole context, and syncs back with no row changed`,
          () =>
            Effect.gen(function* () {
              const group = recording.chats.filter((chat) => rootOf(chat) === root.session.id)
              const host = yield* setup({ id: root.session.id, isStarted: false })
              const delivered: Array<string> = []
              const connected = yield* Deferred.make<void>()
              const observed = yield* Deferred.make<void>()
              const barrier = `Delivery checked ${crypto.randomUUID()}`
              const events = yield* host.brain.chat.event["event.subscribe"]()
              yield* events.pipe(
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    if (event.type === "server.connected") yield* Deferred.succeed(connected, undefined)
                    if (
                      event.type === "session.inbox.delivered" &&
                      event.data.sessionID === root.session.id &&
                      root.inbox.some((row) => row.id === event.data.inboxID)
                    )
                      delivered.push(event.data.inboxID)
                    if (event.type === "session.renamed" && event.data.title === barrier)
                      yield* Deferred.succeed(observed, undefined)
                  }),
                ),
                Effect.forkScoped,
              )
              yield* Deferred.await(connected)
              const remote = yield* SyncClient.make(
                host.proxy.url,
                Effect.sync(() => host.token.value),
              ).pipe(Effect.provide(FetchHttpClient.layer))
              yield* Effect.forEach(
                group,
                Effect.fnUntraced(function* (chat) {
                  const params = {
                    id: chat.session.id,
                    upload: yield* remote.startUpload(chat.session.id, chat.session.parent_id),
                  }
                  yield* remote.uploadMessages(params, chat.messages)
                  yield* remote.commit(params, {
                    session: { ...chat.session, directory: host.brain.directory },
                    seq: 1,
                    ids: chat.messages.map((message) => message.id),
                    inbox: chat.inbox,
                    revertMessageId: null,
                    harnessVersion: recording.version,
                  })
                }),
                { discard: true },
              )
              const sync = yield* host.sync()
              yield* sync.restore({
                sessionId: root.session.id,
                exists: host.brain.transcript.has,
                start: () => Effect.void,
                import: host.brain.transcript.restore,
              })
              for (const chat of group) {
                const inbox = Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeInboxRow))(
                  host.db
                    .query("select * from session_inbox where session_id = ? order by enqueued_seq")
                    .all(chat.session.id),
                )
                expect(
                  inbox.map((row) => ({ id: row.id, type: row.type, payload: row.payload, delivery: row.delivery })),
                ).toEqual(
                  chat.inbox.map((row) => ({
                    id: row.id,
                    type: row.type,
                    payload: row.payload,
                    delivery: row.delivery,
                  })),
                )
                const restored = Schema.decodeUnknownSync(Sync.OpenCodeSessionRow)(
                  host.db.query("select * from session_v2 where id = ?").get(chat.session.id),
                )
                expect({ agent: restored.agent, model: restored.model, permission: restored.permission }).toEqual({
                  agent: chat.session.agent,
                  model: chat.session.model,
                  permission: chat.session.permission,
                })
                expect(restored.time_suspended).toBeNull()
              }
              expect(yield* sync.step()).toEqual({ drained: true })
              expect(
                (yield* remote.restore(root.session.id))
                  .flatMap((chat) => chat.inbox)
                  .map((row) => ({
                    id: row.id,
                    type: row.type,
                    payload: row.payload,
                    delivery: row.delivery,
                  })),
              ).toEqual(
                group
                  .flatMap((chat) => chat.inbox)
                  .map((row) => ({
                    id: row.id,
                    type: row.type,
                    payload: row.payload,
                    delivery: row.delivery,
                  })),
              )
              const script = stub.script()
              yield* host.turn(root.session.id, script)
              const context = JSON.stringify(script.calls.at(0)?.body.messages)
              const compactions = root.messages.flatMap((message) =>
                message.type === "compaction" ? [Schema.decodeUnknownSync(Compaction)(message.data)] : [],
              )
              for (const compaction of compactions) {
                expect(context).toContain(JSON.stringify(compaction.summary).slice(1, -1))
                if (compaction.recent) expect(context).toContain(JSON.stringify(compaction.recent).slice(1, -1))
              }
              expect(yield* sync.step()).toEqual({ drained: true })
              const synced = new Map((yield* SyncTest.remote(root.session.id)).messages.map((row) => [row.id, row]))
              for (const queued of root.inbox) {
                const delivered = synced.get(queued.id)
                expect(delivered?.type).toBe(queued.type)
                expect(delivered && OpenCodeRows.stored(delivered)).toMatchObject(
                  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
                    queued.payload,
                  ),
                )
              }
              for (const message of group.flatMap((chat) => chat.messages)) {
                const row = synced.get(message.id)
                const actual: unknown = row && OpenCodeRows.stored(row)
                expect(actual).toEqual(OpenCodeRows.stored(message))
              }
              yield* host.turn(root.session.id)
              yield* host.driver.rename(root.session.id, barrier)
              yield* Deferred.await(observed)
              expect(delivered.toSorted()).toEqual(root.inbox.map((row) => row.id).toSorted())
              expect(
                yield* host.brain.chat.session["session.inbox.list"]({ params: { sessionID: root.session.id } }),
              ).toEqual([])
            }),
          60_000,
        )
    },
  )

  it.live("a session that OpenCode deletes during a pass does not commit, and the next step does not send it", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      const child = yield* host.create(host.root)
      host.proxy.once({
        match: isStart(child),
        before: () => Effect.runPromise(host.driver.remove(child)),
      })
      yield* sync.step()
      expect(host.proxy.requests.filter(isCommit(child))).toEqual([])
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(paths(host.proxy.requests).filter((path) => path.includes(child))).toEqual([])
    }),
  )

  it.live(
    "a row larger than O2 syncs as a short stand-in, and the rest of its chat syncs (EN37, chaos row 10)",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        yield* host.turn(child, stub.script({ reply: "done" }))
        const large = host.db
          .query<{ id: string }, [string]>(
            "select id from session_message where session_id = ? and type = 'assistant' order by seq desc limit 1",
          )
          .get(child)
        if (!large) return yield* Effect.die(new Error("The assistant message is missing"))
        // oxlint-disable-next-line ren/no-comments -- OpenCode keeps no model reply this large, so the test makes one row larger than a sync request.
        host.db.run("update session_message set data = json_set(data, '$.padding', ?) where id = ?", [
          "a".repeat(Sync.maxBodyBytes + 1024 * 1024),
          large.id,
        ])
        const before = yield* Metric.value(OpenCodeSync.oversizedRows)
        const captured = logs()
        expect(yield* sync.step().pipe(Effect.provide(captured.layer))).toEqual({ drained: true })
        expect((yield* Metric.value(OpenCodeSync.oversizedRows)).count).toBe(before.count + 1)
        expect(captured.annotations.filter((annotation) => annotation["ren.message.id"] === large.id)).toHaveLength(1)
        const synced = yield* SyncTest.remote(host.brain.id)
        expect(synced.sessions.map((session) => String(session.id)).toSorted()).toEqual(
          [String(host.brain.id), String(child)].toSorted(),
        )
        const local = host.db
          .query<{ id: string }, [string]>("select id from session_message where session_id = ? order by seq, id")
          .all(child)
        const remote = synced.messages.filter((message) => String(message.session_id) === String(child))
        expect(remote.map((message) => message.id).toSorted()).toEqual(local.map((message) => message.id).toSorted())
        expect(remote.find((message) => message.id === large.id)).toMatchObject({ type: "synthetic" })
        expect(remote.find((message) => message.id === large.id)?.data).toContain(OpenCodeRows.tooLarge)
        host.proxy.clear()
        expect(yield* sync.step()).toEqual({ drained: true })
        expect(host.proxy.requests.filter(isStart(child))).toEqual([])
      }),
    60_000,
  )

  it.live("with no OpenCode tables, the step is drained and sends no request", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const file = join(yield* folder, "empty.db")
      yield* Effect.promise(() => Bun.write(file, ""))
      const sync = yield* host.sync({ reader: yield* SqliteReader.make(file) })
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(host.proxy.requests).toEqual([])
    }),
  )

  it.live(
    "restore reads a chat of more than 20 MB in pages that each stay under the sync body limit",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        yield* host.turn(host.root, stub.script({ reply: "a".repeat(1_200_000) }))
        const columns = host.db
          .query<{ name: string }, []>("pragma table_info(session_message)")
          .all()
          .map((column) => column.name)
        const largest = host.db
          .query<{ id: string; seq: number }, [string]>(
            "select id, seq from session_message where session_id = ? order by length(data) desc limit 1",
          )
          .get(host.root)
        const last = host.db
          .query<{ seq: number }, [string]>("select max(seq) as seq from session_message where session_id = ?")
          .get(host.root)
        if (!largest || !last) return yield* Effect.die(new Error("The turn wrote no message"))
        const copied = columns
          .map((column) => {
            if (column === "id") return "'msg_copy_' || printf('%04d', n)"
            return column === "seq" ? `${last.seq} + n` : column
          })
          .join(", ")
        host.db.transaction(() => {
          host.db.run(
            `insert into session_message (${columns.join(", ")}) with recursive copies(n) as (select 1 union all select n + 1 from copies where n < 20) select ${copied} from session_message, copies where id = ?`,
            [largest.id],
          )
          host.db.run("update event_sequence set seq = ? where aggregate_id = ?", [last.seq + 20, host.root])
        })()
        const sync = yield* host.sync()
        expect(yield* sync.step()).toEqual({ drained: true })
        const expected = yield* host.expectEqual
        const sizes: Array<number> = []
        const record = (): void =>
          host.proxy.once({
            match: (request) => request.path === `/host/sync/sessions/${host.root}/messages`,
            after: async (response) => {
              sizes.push((await response.arrayBuffer()).byteLength)
              record()
            },
          })
        record()
        const imported: Array<Sync.OpenCodeMessageRow> = []
        yield* sync.restore({
          sessionId: host.brain.id,
          exists: () => Effect.succeed(false),
          start: () => Effect.void,
          import: (data) => Effect.sync(() => imported.push(...data.messages)),
        })
        expect(imported.map((message) => message.id)).toEqual(expected.messages.map((message) => message.id))
        expect(sizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(20_000_000)
        expect(Math.max(...sizes)).toBeLessThanOrEqual(Sync.maxBodyBytes)
      }),
    60_000,
  )

  it.live("a missing column stops the step before any request and logs an error. Ren gets no rows", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      yield* host.turn(host.root)
      const file = join(yield* folder, "old.db")
      host.db.run(`vacuum into '${file}'`)
      const old = new Database(file)
      old.run("alter table session_v2 drop column title")
      old.close()
      const sync = yield* host.sync({ reader: yield* SqliteReader.make(file) })
      const captured = logs()
      const error = yield* Effect.flip(sync.step().pipe(Effect.provide(captured.layer)))
      expect(error.reason).toBe("incompatible")
      expect(captured.messages.filter((message) => message.includes("session_v2.title"))).toHaveLength(1)
      expect(host.proxy.requests).toEqual([])
      expect(yield* SyncTest.remote(host.brain.id)).toEqual({ sessions: [], messages: [] })
    }),
  )

  it.live(
    "a busy session gets no second pass before the O4 limit. The pass after the turn ends has no delay. After a restart, the first step does a pass at once. Use TestClock",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const clock = yield* Layer.build(TestClock.layer())
        const step = (sync: OpenCodeSync.Interface) => sync.step().pipe(Effect.provideContext(clock))
        const passed = Effect.fnUntraced(function* (sync: OpenCodeSync.Interface) {
          host.proxy.clear()
          const result = yield* step(sync)
          return { ...result, passed: host.proxy.requests.some(isCommit(host.root)) }
        })
        const first = yield* host.sync()
        const script = stub.script({ hold: true })
        yield* host.driver.prompt(host.root, script.marker)
        yield* Effect.promise(() => script.called())
        expect(yield* passed(first)).toEqual({ drained: true, passed: true })
        expect(yield* SyncTest.status(host.root)).toBe("busy")
        const interval = Duration.toMillis(OpenCodeSync.busyInterval)
        yield* host.driver.rename(host.root, "One")
        expect(yield* passed(first)).toEqual({ drained: false, throttledUntil: interval, passed: false })
        expect(paths(host.proxy.requests)).toEqual([checkpoints])
        yield* TestClock.adjust(OpenCodeSync.busyInterval).pipe(Effect.provideContext(clock))
        expect(yield* passed(first)).toEqual({ drained: true, passed: true })
        yield* host.driver.rename(host.root, "Two")
        expect(yield* passed(first)).toEqual({ drained: false, throttledUntil: 2 * interval, passed: false })
        const restarted = yield* host.sync()
        expect(yield* passed(restarted)).toEqual({ drained: true, passed: true })
        script.release()
        yield* host.driver.wait(host.root)
        expect(yield* passed(restarted)).toEqual({ drained: true, passed: true })
        expect(yield* SyncTest.status(host.root)).toBe("idle")
        yield* host.expectEqual
      }),
    60_000,
  )

  it.live(
    "Ren refuses an unknown root. The host logs it one time and does not send it or its children again in that process",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const unknown = yield* host.create()
        const child = yield* host.create(unknown)
        const captured = logs()
        expect(yield* sync.step().pipe(Effect.provide(captured.layer))).toEqual({ drained: true })
        yield* host.driver.rename(unknown, "Changed")
        yield* host.driver.rename(child, "Changed")
        expect(yield* sync.step().pipe(Effect.provide(captured.layer))).toEqual({ drained: true })
        expect(captured.messages.filter((message) => message.includes(unknown))).toHaveLength(1)
        expect(paths(host.proxy.requests).filter((path) => path.includes(unknown))).toEqual([uploads(unknown)])
        expect(paths(host.proxy.requests).filter((path) => path.includes(child))).toEqual([])
      }),
  )

  it.live(
    "Ren refuses a child because the pass of its parent failed. The next step sends the child again, and Ren adopts it",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        const grandchild = yield* host.create(child)
        host.proxy.once({ match: isStart(child), fault: "fail" })
        expect(yield* sync.step()).toEqual({ drained: false, failed: true })
        expect(host.proxy.requests.filter(isStart(grandchild))).toHaveLength(1)
        expect(host.proxy.requests.filter(isCommit(grandchild))).toEqual([])
        expect(yield* sync.step()).toEqual({ drained: true })
        const synced = yield* host.expectEqual
        expect(synced.sessions.map((session) => String(session.id)).toSorted()).toEqual(
          [host.root, child, grandchild].map(String).toSorted(),
        )
      }),
  )

  it.live(
    "one step syncs a root, a child, and a grandchild that Ren does not have, with each parent before its children",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        const grandchild = yield* host.create(child)
        yield* host.turn(grandchild)
        yield* host.turn(child)
        expect(yield* sync.step()).toEqual({ drained: true })
        expect(
          paths(host.proxy.requests).filter((path) =>
            [host.root, child, grandchild].some((id) => path === uploads(id)),
          ),
        ).toEqual([uploads(host.root), uploads(child), uploads(grandchild)])
        yield* host.expectEqual
      }),
  )

  it.live("a step skips a chat while its restore flag is set. A step and a restore never run at the same time", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      host.host.restoring.add(renId(host.root))
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(host.proxy.requests.filter(isStart(host.root))).toEqual([])
      host.host.restoring.delete(renId(host.root))
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const restore = yield* sync
        .exclusive(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const step = yield* sync.step().pipe(Effect.forkChild)
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))
      expect(step.pollUnsafe()).toBeUndefined()
      expect(host.proxy.requests.filter(isStart(host.root))).toEqual([])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(restore)
      expect(yield* Fiber.join(step)).toEqual({ drained: true })
    }),
  )

  it.live(
    "a host token that expires during a pass stops the pass. The next step with a new token gives an equal result",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        yield* host.turn(host.root)
        const expired = yield* tokenFor(host.brain.id, host.owner.organizationId, -(BrainToken.toleranceSeconds + 60))
        host.proxy.once({ match: isBatch(host.root), before: () => Promise.resolve((host.token.value = expired)) })
        expect(yield* sync.step()).toEqual({ drained: false, failed: true })
        expect(host.proxy.requests.filter(isCommit(host.root))).toHaveLength(1)
        expect((yield* SyncTest.remote(host.brain.id)).sessions).toEqual([])
        host.token.value = yield* tokenFor(host.brain.id, host.owner.organizationId, 600)
        expect(yield* sync.step()).toEqual({ drained: true })
        yield* host.expectEqual
      }),
  )

  it.live(
    "after the deadline of a step, a pass that started finishes, no new pass starts, and the step is not drained",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        const clock = yield* Layer.build(TestClock.layer())
        const reached = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        host.proxy.once({
          match: isCommit(host.root),
          before: () => {
            reached.resolve()
            return release.promise
          },
        })
        const step = yield* sync.step({ deadline: 1000 }).pipe(Effect.provideContext(clock), Effect.forkChild)
        yield* Effect.promise(() => reached.promise)
        yield* TestClock.adjust("2 seconds").pipe(Effect.provideContext(clock))
        release.resolve()
        expect(yield* Fiber.join(step)).toEqual({ drained: false })
        expect(host.proxy.requests.filter(isCommit(host.root))).toHaveLength(1)
        expect(host.proxy.requests.filter(isStart(child))).toEqual([])
        expect(yield* sync.step()).toEqual({ drained: true })
        yield* host.expectEqual
      }),
  )
  it.live(
    "a crash during the restore of one chat leaves only that chat flagged: the next step uploads the others and skips it and its children",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const other = yield* host.create()
        yield* Seed.session({ ...host.owner, brainId: Brain.ofSession(renId(host.root)) }, { sessionId: renId(other) })
        const child = yield* host.create(host.root)
        expect(yield* sync.step()).toEqual({ drained: true })
        const restoring = yield* sync
          .restore({
            sessionId: renId(host.root),
            exists: () => Effect.succeed(false),
            start: () => Effect.void,
            import: () => Effect.die(new Error("the brain stops during the restore")),
          })
          .pipe(Effect.exit)
        expect(restoring._tag).toBe("Failure")
        expect([...host.host.restoring]).toEqual([renId(host.root)])
        yield* Effect.forEach([host.root, child, other], (id) => host.driver.rename(id, "Changed"))
        host.proxy.clear()
        expect(yield* sync.step()).toEqual({ drained: true })
        expect(host.proxy.requests.filter(isStart(other))).toHaveLength(1)
        expect(host.proxy.requests.filter(isStart(host.root))).toEqual([])
        expect(host.proxy.requests.filter(isStart(child))).toEqual([])
      }),
  )
})
