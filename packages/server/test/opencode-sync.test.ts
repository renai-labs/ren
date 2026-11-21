import { describe, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { OpenCodeSync } from "@ren/opencode-transcript/opencode-sync"
import { SqliteReader } from "@ren/opencode-transcript/sqlite-reader"
import { BrainToken } from "@ren/host-api/brain-token"
import { Sync } from "@ren/schema/sync"
import { Seed } from "@ren/core/testing"
import { Brain } from "@ren/schema/brain"
import { Deferred, Duration, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { join } from "node:path"
import { OpenCodeSyncTest } from "./lib/opencode-sync.js"
import { SyncTest } from "./lib/sync.js"

const it = { live: SyncTest.live }

describe("OpenCodeSync", () => {
  it.live("a revert while sync is late marks the reverted messages removed in Postgres", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
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
      const host = yield* OpenCodeSyncTest.setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      yield* sync.step()
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(OpenCodeSyncTest.paths(host.proxy.requests)).toEqual([OpenCodeSyncTest.checkpoints])
    }),
  )

  it.live("a claim that changes only time_suspended makes Ren show busy. A release makes Ren show idle", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
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

  it.live("Ren applies the commit, and the reply is lost. The next step does no pass", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      host.proxy.once({ match: OpenCodeSyncTest.isCommit(host.root), fault: "lose" })
      expect(yield* sync.step()).toEqual({ drained: false, failed: true })
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(OpenCodeSyncTest.paths(host.proxy.requests)).toEqual([OpenCodeSyncTest.checkpoints])
      yield* host.expectEqual
    }),
  )

  it.live(
    "a message that OpenCode writes between the read of E and the read of L is in Postgres after the next step",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
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
      const host = yield* OpenCodeSyncTest.setup()
      const sync = yield* host.sync()
      yield* host.turn(host.root)
      host.proxy.once({
        match: OpenCodeSyncTest.isCommit(host.root),
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
      const host = yield* OpenCodeSyncTest.setup()
      const sync = yield* host.sync()
      yield* host.driver.rename(host.root, "a\u0000b")
      expect(yield* sync.step()).toEqual({ drained: true })
      expect((yield* SyncTest.remote(host.brain.id)).sessions.map((session) => session.title)).toEqual(["a\uFFFDb"])
    }),
  )

  it.live(
    "after a turn, a subagent and a shell command, each OpenCode table with rows is one that sync reads or one that Ren keeps out on purpose",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const child = OpenCodeSyncTest.stub.script()
        yield* host.turn(
          host.root,
          OpenCodeSyncTest.stub.script({
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
      const host = yield* OpenCodeSyncTest.setup()
      yield* host.turn(host.root)
      const sync = yield* host.sync({ version: "2.10.0" })
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(yield* SyncTest.harnessVersion(host.root)).toBe("2.10.0")
    }),
  )

  it.live("a session that OpenCode deletes during a pass does not commit, and the next step does not send it", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
      const sync = yield* host.sync()
      const child = yield* host.create(host.root)
      host.proxy.once({
        match: OpenCodeSyncTest.isStart(child),
        before: () => Effect.runPromise(host.driver.remove(child)),
      })
      yield* sync.step()
      expect(host.proxy.requests.filter(OpenCodeSyncTest.isCommit(child))).toEqual([])
      host.proxy.clear()
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(OpenCodeSyncTest.paths(host.proxy.requests).filter((path) => path.includes(child))).toEqual([])
    }),
  )

  it.live("with no OpenCode tables, the step is drained and sends no request", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
      const file = join(yield* OpenCodeSyncTest.folder, "empty.db")
      yield* Effect.promise(() => Bun.write(file, ""))
      const sync = yield* host.sync({ reader: yield* SqliteReader.make(file) })
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(host.proxy.requests).toEqual([])
    }),
  )

  it.live("a missing column stops the step before any request and logs an error. Ren gets no rows", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
      yield* host.turn(host.root)
      const file = join(yield* OpenCodeSyncTest.folder, "old.db")
      host.db.run(`vacuum into '${file}'`)
      const old = new Database(file)
      old.run("alter table session_v2 drop column title")
      old.close()
      const sync = yield* host.sync({ reader: yield* SqliteReader.make(file) })
      const captured = OpenCodeSyncTest.logs()
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
        const host = yield* OpenCodeSyncTest.setup()
        const clock = yield* Layer.build(TestClock.layer())
        const step = (sync: OpenCodeSync.Interface) => sync.step().pipe(Effect.provideContext(clock))
        const passed = Effect.fnUntraced(function* (sync: OpenCodeSync.Interface) {
          host.proxy.clear()
          const result = yield* step(sync)
          return { ...result, passed: host.proxy.requests.some(OpenCodeSyncTest.isCommit(host.root)) }
        })
        const first = yield* host.sync()
        const script = OpenCodeSyncTest.stub.script({ hold: true })
        yield* host.driver.prompt(host.root, script.marker)
        yield* Effect.promise(() => script.called())
        expect(yield* passed(first)).toEqual({ drained: true, passed: true })
        expect(yield* SyncTest.status(host.root)).toBe("busy")
        const interval = Duration.toMillis(OpenCodeSync.busyInterval)
        yield* host.driver.rename(host.root, "One")
        expect(yield* passed(first)).toEqual({ drained: false, throttledUntil: interval, passed: false })
        expect(OpenCodeSyncTest.paths(host.proxy.requests)).toEqual([OpenCodeSyncTest.checkpoints])
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
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        const unknown = yield* host.create()
        const child = yield* host.create(unknown)
        const captured = OpenCodeSyncTest.logs()
        expect(yield* sync.step().pipe(Effect.provide(captured.layer))).toEqual({ drained: true })
        yield* host.driver.rename(unknown, "Changed")
        yield* host.driver.rename(child, "Changed")
        expect(yield* sync.step().pipe(Effect.provide(captured.layer))).toEqual({ drained: true })
        expect(captured.messages.filter((message) => message.includes(unknown))).toHaveLength(1)
        expect(OpenCodeSyncTest.paths(host.proxy.requests).filter((path) => path.includes(unknown))).toEqual([
          OpenCodeSyncTest.uploads(unknown),
        ])
        expect(OpenCodeSyncTest.paths(host.proxy.requests).filter((path) => path.includes(child))).toEqual([])
      }),
  )

  it.live(
    "Ren refuses a child because the pass of its parent failed. The next step sends the child again, and Ren adopts it",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        const grandchild = yield* host.create(child)
        host.proxy.once({ match: OpenCodeSyncTest.isStart(child), fault: "fail" })
        expect(yield* sync.step()).toEqual({ drained: false, failed: true })
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(grandchild))).toHaveLength(1)
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isCommit(grandchild))).toEqual([])
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
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        const grandchild = yield* host.create(child)
        yield* host.turn(grandchild)
        yield* host.turn(child)
        expect(yield* sync.step()).toEqual({ drained: true })
        expect(
          OpenCodeSyncTest.paths(host.proxy.requests).filter((path) =>
            [host.root, child, grandchild].some((id) => path === OpenCodeSyncTest.uploads(id)),
          ),
        ).toEqual([
          OpenCodeSyncTest.uploads(host.root),
          OpenCodeSyncTest.uploads(child),
          OpenCodeSyncTest.uploads(grandchild),
        ])
        yield* host.expectEqual
      }),
  )

  it.live("a step skips a chat while its restore flag is set. A step and a restore never run at the same time", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
      const sync = yield* host.sync()
      host.host.restoring.add(OpenCodeSyncTest.renId(host.root))
      expect(yield* sync.step()).toEqual({ drained: true })
      expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(host.root))).toEqual([])
      host.host.restoring.delete(OpenCodeSyncTest.renId(host.root))
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const restore = yield* sync
        .exclusive(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const step = yield* sync.step().pipe(Effect.forkChild)
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))
      expect(step.pollUnsafe()).toBeUndefined()
      expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(host.root))).toEqual([])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(restore)
      expect(yield* Fiber.join(step)).toEqual({ drained: true })
    }),
  )

  it.live(
    "a host token that expires during a pass stops the pass. The next step with a new token gives an equal result",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        yield* host.turn(host.root)
        const expired = yield* OpenCodeSyncTest.tokenFor(
          host.brain.id,
          host.owner.organizationId,
          -(BrainToken.toleranceSeconds + 60),
        )
        host.proxy.once({
          match: OpenCodeSyncTest.isBatch(host.root),
          before: () => Promise.resolve((host.token.value = expired)),
        })
        expect(yield* sync.step()).toEqual({ drained: false, failed: true })
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isCommit(host.root))).toHaveLength(1)
        expect((yield* SyncTest.remote(host.brain.id)).sessions).toEqual([])
        host.token.value = yield* OpenCodeSyncTest.tokenFor(host.brain.id, host.owner.organizationId, 600)
        expect(yield* sync.step()).toEqual({ drained: true })
        yield* host.expectEqual
      }),
  )

  it.live(
    "after the deadline of a step, a pass that started finishes, no new pass starts, and the step is not drained",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        const clock = yield* Layer.build(TestClock.layer())
        const reached = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        host.proxy.once({
          match: OpenCodeSyncTest.isCommit(host.root),
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
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isCommit(host.root))).toHaveLength(1)
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(child))).toEqual([])
        expect(yield* sync.step()).toEqual({ drained: true })
        yield* host.expectEqual
      }),
  )
  it.live(
    "a crash during the restore of one chat leaves only that chat flagged: the next step uploads the others and skips it and its children",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        const other = yield* host.create()
        yield* Seed.session(
          { ...host.owner, brainId: Brain.ofSession(OpenCodeSyncTest.renId(host.root)) },
          { sessionId: OpenCodeSyncTest.renId(other) },
        )
        const child = yield* host.create(host.root)
        expect(yield* sync.step()).toEqual({ drained: true })
        const restoring = yield* sync
          .restore({
            sessionId: OpenCodeSyncTest.renId(host.root),
            exists: () => Effect.succeed(false),
            start: () => Effect.void,
            import: () => Effect.die(new Error("the brain stops during the restore")),
          })
          .pipe(Effect.exit)
        expect(restoring._tag).toBe("Failure")
        expect([...host.host.restoring]).toEqual([OpenCodeSyncTest.renId(host.root)])
        yield* Effect.forEach([host.root, child, other], (id) => host.driver.rename(id, "Changed"))
        host.proxy.clear()
        expect(yield* sync.step()).toEqual({ drained: true })
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(other))).toHaveLength(1)
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(host.root))).toEqual([])
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(child))).toEqual([])
      }),
  )
})
