import { describe, expect } from "bun:test"
import { OpenCodeSync } from "@ren/opencode-transcript/opencode-sync"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import { OpenCodeFixtures } from "@ren/opencode-transcript/testing"
import { Sync } from "@ren/schema/sync"
import { SyncClient } from "@ren/cell/testing"
import type { Session as RenSession } from "@ren/schema/session"
import { Deferred, Effect, Metric, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { OpenCodeSyncTest } from "./lib/opencode-sync.js"
import { SyncTest } from "./lib/sync.js"

const it = { live: SyncTest.live }

describe("OpenCodeSync", () => {
  it.live(
    "a long session with tool calls, a subagent, a retry, and a shell command is equal in SQLite and in Postgres",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        yield* host.turn(host.root)
        yield* host.turn(
          host.root,
          OpenCodeSyncTest.stub.script({ tool: { name: "skill", input: { name: "missing" } } }),
        )
        const child = OpenCodeSyncTest.stub.script()
        yield* host.turn(
          host.root,
          OpenCodeSyncTest.stub.script({
            tool: {
              name: "subagent",
              input: { agent: "general", description: "Look", prompt: `${child.marker} look` },
            },
          }),
        )
        yield* Effect.promise(() => child.called())
        const retry = OpenCodeSyncTest.stub.script({ status: 503 })
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

  it.live(
    "a step that fails at the start of the upload, at a batch after the first, or at the commit, then runs again, gives an equal result",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        yield* host.turn(host.root)
        yield* host.turn(host.root, OpenCodeSyncTest.stub.script({ reply: "a".repeat(1_200_000) }))
        yield* host.turn(host.root)
        yield* sync.step()
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isBatch(host.root)).length).toBeGreaterThanOrEqual(3)
        yield* Effect.forEach(
          [
            OpenCodeSyncTest.isStart(host.root),
            OpenCodeSyncTest.nth(2, OpenCodeSyncTest.isBatch(host.root)),
            OpenCodeSyncTest.isCommit(host.root),
          ],
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

  it.live("restore reads every page of a session with more messages than one page, in transcript order", () =>
    Effect.gen(function* () {
      const host = yield* OpenCodeSyncTest.setup()
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
              const host = yield* OpenCodeSyncTest.setup({ id: root.session.id, isStarted: false })
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
              const script = OpenCodeSyncTest.stub.script()
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

  it.live(
    "a row larger than O2 syncs as a short stand-in, and the rest of its chat syncs",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        const sync = yield* host.sync()
        const child = yield* host.create(host.root)
        yield* host.turn(child, OpenCodeSyncTest.stub.script({ reply: "done" }))
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
        const captured = OpenCodeSyncTest.logs()
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
        expect(host.proxy.requests.filter(OpenCodeSyncTest.isStart(child))).toEqual([])
      }),
    60_000,
  )

  it.live(
    "restore reads a chat of more than 20 MB in pages that each stay under the sync body limit",
    () =>
      Effect.gen(function* () {
        const host = yield* OpenCodeSyncTest.setup()
        yield* host.turn(host.root, OpenCodeSyncTest.stub.script({ reply: "a".repeat(1_200_000) }))
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
})
