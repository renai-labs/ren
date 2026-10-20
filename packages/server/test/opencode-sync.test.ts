import { describe, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { AbsolutePath, Session, SessionMessage } from "@opencode/client/effect"
import { OpenCodeSync } from "@ren/brain/opencode-sync"
import { SqliteReader } from "@ren/brain/sqlite-reader"
import { SessionToken } from "@ren/host-api/session-token"
import { Sync } from "@ren/schema/sync"
import { Shared, type StubModel, SyncClient } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Seed } from "@ren/core/testing"
import type { Auth } from "@ren/schema/auth"
import type { Session as RenSession } from "@ren/schema/session"
import { Clock, Deferred, Duration, Effect, Fiber, Layer, Logger, Metric, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { TestClock } from "effect/testing"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cellKey } from "./lib/app.js"
import { Proxy } from "./lib/proxy.js"
import { SyncTest } from "./lib/sync.js"

const it = { live: SyncTest.live }

const stub = Shared.stub()

const folder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "opencode-sync-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

const hostToken = Effect.fnUntraced(function* (sid: RenSession.ID, org: Auth.OrganizationID, seconds: number) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  return yield* SessionToken.sign(cellKey, { sid, scope: "host", org, iat: now, exp: now + seconds })
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

const checkpoints = "/brain/sync/checkpoints"

const uploads = (id: string) => `/brain/sync/sessions/${id}/uploads`

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
  return {
    messages,
    layer: Logger.layer([Logger.make((options) => void messages.push([options.message].flat().map(String).join(" ")))]),
  }
}

const setup = Effect.fnUntraced(function* () {
  const file = join(yield* folder, "opencode.db")
  const brain = yield* SyncTest.isolated(BrainTest.make({ database: file }))
  yield* brain.start({ interactive: false, title: "Sync" })
  const owner = yield* Seed.owner()
  yield* Seed.session(owner, { sessionId: brain.id })
  const server = yield* HttpServer.HttpServer
  const proxy = yield* Proxy.make(HttpServer.formatAddress(server.address))
  const token = { value: yield* hostToken(brain.id, owner.organizationId, 600) }
  const host = { restoring: false }
  const db = new Database(file)
  yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
  const reader = yield* SqliteReader.make(file)
  const client = brain.opencode
  const root = Session.ID.make(brain.id)
  const location = { directory: AbsolutePath.make(brain.directory) }
  const sync = (input: { readonly reader?: OpenCodeSync.Reader } = {}) =>
    SyncClient.make(
      proxy.url,
      Effect.sync(() => token.value),
    ).pipe(
      Effect.flatMap((remote) =>
        OpenCodeSync.make({ remote, reader: input.reader ?? reader, restoring: Effect.sync(() => host.restoring) }),
      ),
      Effect.provide(FetchHttpClient.layer),
    )
  const create = (parentID?: Session.ID) =>
    client.session.create({ location, ...(parentID && { parentID }) }).pipe(
      Effect.orDie,
      Effect.map((session) => session.id),
    )
  const turn = Effect.fnUntraced(function* (sessionID: Session.ID, script: StubModel.Script = stub.script()) {
    yield* client.session.prompt({ sessionID, text: `Go ${script.marker}` }).pipe(Effect.orDie)
    yield* Effect.promise(() => script.called())
    yield* client.session.wait({ sessionID }).pipe(Effect.orDie)
  })
  const rename = (sessionID: Session.ID, title: string) =>
    client.session.update({ sessionID, title }).pipe(Effect.orDie)
  const expectEqual = Effect.gen(function* () {
    const expected = local(db, brain.id)
    expect(yield* SyncTest.remote(brain.id)).toEqual(expected)
    return expected
  })
  return { brain, owner, root, proxy, token, host, db, reader, client, sync, create, turn, rename, expectEqual }
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
        yield* host.client.session.prompt({ sessionID: host.root, text: retry.marker }).pipe(Effect.orDie)
        yield* Effect.promise(() => retry.called())
        retry.set({})
        yield* Effect.promise(() => retry.called(2))
        yield* host.client.session.wait({ sessionID: host.root }).pipe(Effect.orDie)
        yield* host.client.session.shell({ sessionID: host.root, command: "echo shell" }).pipe(Effect.orDie)
        yield* host.client.session.wait({ sessionID: host.root }).pipe(Effect.orDie)
        expect(yield* sync.step()).toEqual({ drained: true })
        const synced = yield* host.expectEqual
        expect(synced.sessions).toHaveLength(2)
        expect(synced.messages.map((message) => message.type)).toEqual(
          expect.arrayContaining(["user", "assistant", "shell"]),
        )
      }),
    60_000,
  )

  it.live("a revert while sync is late deletes the reverted messages in Postgres", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      yield* host.turn(host.root)
      yield* sync.step()
      const before = yield* host.expectEqual
      const second = before.messages.filter((message) => message.type === "user")[1]
      if (!second) return yield* Effect.die(new Error("The second user message is missing"))
      yield* host.client.session.revert
        .stage({ sessionID: host.root, messageID: SessionMessage.ID.make(second.id) })
        .pipe(Effect.orDie)
      yield* host.client.session.revert.commit({ sessionID: host.root }).pipe(Effect.orDie)
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
              yield* host.rename(host.root, `Case ${index}`)
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
        before: () => Effect.runPromise(host.rename(host.root, "Renamed during the pass")),
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
      yield* host.rename(host.root, "a\u0000b")
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
        create: Effect.void,
        setRestoring: (value) => Effect.sync(() => void (host.host.restoring = value)),
        import: (data) => Effect.sync(() => imported.push(...data.messages)),
      })
      expect(imported.map((message) => message.id)).toEqual(expected.messages.map((message) => message.id))
      expect(
        host.proxy.requests.filter((request) => request.path === `/brain/sync/sessions/${host.root}/messages`),
      ).toHaveLength(Math.floor(expected.messages.length / 500) + 1)
    }),
  )

  it.live("a session that OpenCode deletes during a pass does not commit, and the next step does not send it", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      const child = yield* host.create(host.root)
      host.proxy.once({
        match: isStart(child),
        before: () => Effect.runPromise(host.client.session.remove({ sessionID: child }).pipe(Effect.orDie)),
      })
      yield* sync.step()
      expect(host.proxy.requests.filter(isCommit(child))).toEqual([])
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(paths(host.proxy.requests).filter((path) => path.includes(child))).toEqual([])
    }),
  )

  it.live(
    "a row larger than O2 stops the pass with no commit, logs the row, and increases the counter. The step is not drained. The other sessions of the step sync",
    () =>
      Effect.gen(function* () {
        const host = yield* setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        yield* host.turn(child, stub.script({ reply: "a".repeat(9 * 1024 * 1024) }))
        const large = host.db
          .query<{ id: string }, [string]>(
            "select id from session_message where session_id = ? order by length(data) desc limit 1",
          )
          .get(child)
        if (!large) return yield* Effect.die(new Error("The large message is missing"))
        const before = yield* Metric.value(OpenCodeSync.oversizedRows)
        const captured = logs()
        expect(yield* sync.step().pipe(Effect.provide(captured.layer))).toEqual({ drained: false, failed: true })
        expect((yield* Metric.value(OpenCodeSync.oversizedRows)).count).toBe(before.count + 1)
        expect(captured.messages.filter((message) => message.includes(large.id))).toHaveLength(1)
        expect((yield* SyncTest.remote(host.brain.id)).sessions.map((session) => session.id)).toEqual([host.brain.id])
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
        yield* host.client.session.prompt({ sessionID: host.root, text: script.marker }).pipe(Effect.orDie)
        yield* Effect.promise(() => script.called())
        expect(yield* passed(first)).toEqual({ drained: true, passed: true })
        expect(yield* SyncTest.status(host.root)).toBe("busy")
        const interval = Duration.toMillis(OpenCodeSync.busyInterval)
        yield* host.rename(host.root, "One")
        expect(yield* passed(first)).toEqual({ drained: false, throttledUntil: interval, passed: false })
        expect(paths(host.proxy.requests)).toEqual([checkpoints])
        yield* TestClock.adjust(OpenCodeSync.busyInterval).pipe(Effect.provideContext(clock))
        expect(yield* passed(first)).toEqual({ drained: true, passed: true })
        yield* host.rename(host.root, "Two")
        expect(yield* passed(first)).toEqual({ drained: false, throttledUntil: 2 * interval, passed: false })
        const restarted = yield* host.sync()
        expect(yield* passed(restarted)).toEqual({ drained: true, passed: true })
        script.release()
        yield* host.client.session.wait({ sessionID: host.root }).pipe(Effect.orDie)
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
        yield* host.rename(unknown, "Changed")
        yield* host.rename(child, "Changed")
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

  it.live("a step does not run while the restore flag is set. A step and a restore never run at the same time", () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const sync = yield* host.sync()
      host.host.restoring = true
      expect(yield* sync.step()).toEqual({ drained: false })
      expect(host.proxy.requests).toEqual([])
      host.host.restoring = false
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const restore = yield* sync
        .exclusive(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const step = yield* sync.step().pipe(Effect.forkChild)
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))
      expect(step.pollUnsafe()).toBeUndefined()
      expect(host.proxy.requests).toEqual([])
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
        const expired = yield* hostToken(host.brain.id, host.owner.organizationId, -1)
        host.proxy.once({ match: isBatch(host.root), before: () => Promise.resolve((host.token.value = expired)) })
        expect(yield* sync.step()).toEqual({ drained: false, failed: true })
        expect(host.proxy.requests.filter(isCommit(host.root))).toHaveLength(1)
        expect((yield* SyncTest.remote(host.brain.id)).sessions).toEqual([])
        host.token.value = yield* hostToken(host.brain.id, host.owner.organizationId, 600)
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
})
