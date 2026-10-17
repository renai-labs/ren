import { describe, expect } from "bun:test"
import { ForbiddenError, StaleUploadError } from "@ren/brain-api/errors"
import type { CurrentHost } from "@ren/brain-api/host-api"
import type { OpenCodeMessageRow } from "@ren/brain-api/sync-api"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { asc, eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer, Schedule } from "effect"
import { SqlClient } from "effect/sql"
import { SessionSync } from "../src/session-sync.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { Sync } from "./lib/sync.js"

const it = testEffect(SessionSync.layer.pipe(Layer.provideMerge(Testing.layer)))

const tree = Effect.fnUntraced(function* () {
  const owner = yield* Seed.owner()
  const rootId = yield* Seed.session(owner)
  return { owner, rootId, host: { brainId: rootId, organizationId: owner.organizationId } }
})

const stored = Effect.fnUntraced(function* (sessionId: Session.ID) {
  const database = yield* Database.Service
  return {
    sessions: yield* database.db
      .select()
      .from(Database.Schema.agent_session)
      .where(eq(Database.Schema.agent_session.id, sessionId)),
    opencode: (yield* database.db
      .select()
      .from(Database.Schema.opencode_session)
      .where(eq(Database.Schema.opencode_session.session_id, sessionId))).at(0),
    messages: yield* database.db
      .select()
      .from(Database.Schema.opencode_message)
      .where(eq(Database.Schema.opencode_message.session_id, sessionId))
      .orderBy(asc(Database.Schema.opencode_message.seq), asc(Database.Schema.opencode_message.id)),
  }
})

const hold = Effect.fnUntraced(function* (table: string, mode: "share" | "access exclusive") {
  const sql = yield* SqlClient.SqlClient
  const locked = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const holder = yield* Effect.forkChild(
    sql.withTransaction(
      sql
        .unsafe(`lock table ${table} in ${mode} mode`)
        .pipe(Effect.andThen(Deferred.succeed(locked, undefined)), Effect.andThen(Deferred.await(release))),
    ),
  )
  yield* Deferred.await(locked)
  return Deferred.succeed(release, undefined).pipe(Effect.andThen(Fiber.join(holder)), Effect.orDie)
})

const blocked = (count: number) =>
  SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql<{ readonly waiting: number }>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    ),
    Effect.repeat({ until: (rows) => (rows.at(0)?.waiting ?? 0) >= count, schedule: Schedule.spaced("5 millis") }),
    Effect.orDie,
    Effect.asVoid,
  )

const pages = (
  host: CurrentHost["Service"],
  sessionId: Session.ID,
  after?: SessionSync.Cursor,
): Effect.Effect<ReadonlyArray<OpenCodeMessageRow>, ForbiddenError, SessionSync.Service> =>
  SessionSync.Service.pipe(
    Effect.flatMap((sync) => sync.messages(host, sessionId, { after, limit: 2 })),
    Effect.flatMap((page) =>
      page.next
        ? pages(host, sessionId, page.next).pipe(Effect.map((rest) => [...page.messages, ...rest]))
        : Effect.succeed(page.messages),
    ),
  )

describe("SessionSync", () => {
  it.live("a pass replaces the Ren copy, so edited rows change and rows it did not send are deleted", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const prompt = Sync.message(rootId, "msg_1", 2)
      const reply = Sync.message(rootId, "msg_2", 3)
      const idle = Sync.message(rootId, "msg_3", 34)
      yield* Sync.pass(host, Sync.session(rootId, { time_suspended: Sync.now }), 5, [prompt, reply, idle])
      const edited = Sync.message(rootId, prompt.id, prompt.seq, { data: JSON.stringify({ text: "edited" }) })
      const row = Sync.session(rootId, {
        title: "Fix the build",
        idle_outcome: "completed",
        time_updated: Sync.now + 9,
      })
      yield* Sync.pass(host, row, 40, [edited, idle])
      expect((yield* stored(rootId)).messages).toEqual([edited, idle])
      expect(yield* sync.restore(host, rootId)).toEqual([row])
    }),
  )

  it.live("a batch or a commit with an old upload number is stale", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const old = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const current = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const late = Sync.message(rootId, "msg_late", 2)
      expect(yield* Effect.flip(sync.uploadMessages(host, rootId, old, [late]))).toBeInstanceOf(StaleUploadError)
      expect(
        yield* Effect.flip(sync.commit(host, rootId, old, { session: Sync.session(rootId), seq: 2, ids: [late.id] })),
      ).toBeInstanceOf(StaleUploadError)
      const kept = Sync.message(rootId, "msg_kept", 3)
      yield* sync.uploadMessages(host, rootId, current, [kept])
      yield* sync.commit(host, rootId, current, { session: Sync.session(rootId), seq: 3, ids: [kept.id] })
      expect((yield* stored(rootId)).messages).toEqual([kept])
    }),
  )

  it.live("a commit closes its upload, so a late batch or a second copy of the commit is stale", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const kept = Sync.message(rootId, "msg_kept", 2)
      const commit = { session: Sync.session(rootId), seq: 2, ids: [kept.id] }
      yield* sync.uploadMessages(host, rootId, upload, [kept])
      yield* sync.commit(host, rootId, upload, commit)
      expect(
        yield* Effect.flip(sync.uploadMessages(host, rootId, upload, [Sync.message(rootId, "msg_late", 3)])),
      ).toBeInstanceOf(StaleUploadError)
      expect(yield* Effect.flip(sync.commit(host, rootId, upload, commit))).toBeInstanceOf(StaleUploadError)
      expect((yield* stored(rootId)).messages).toEqual([kept])
    }),
  )

  it.live("two uploads that start at the same time for one new child adopt it once, and only the later can write", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const childId = Session.ID.create()
      const release = yield* hold("agent_session", "share")
      const starts = yield* Effect.forkChild(
        Effect.all(
          [0, 1].map(() => sync.startUpload(host, childId, { harness: "opencode", parentId: rootId })),
          { concurrency: "unbounded" },
        ),
      )
      yield* blocked(2)
      yield* release
      expect((yield* Fiber.join(starts)).toSorted((left, right) => left - right)).toEqual([1, 2])
      expect((yield* stored(childId)).sessions).toHaveLength(1)
      const message = Sync.message(childId, "msg_1", 2)
      expect(yield* Effect.flip(sync.uploadMessages(host, childId, 1, [message]))).toBeInstanceOf(StaleUploadError)
      yield* sync.uploadMessages(host, childId, 2, [message])
      expect((yield* stored(childId)).messages).toEqual([message])
    }),
  )

  it.live("a restore that starts while a commit holds the session waits for it and returns the commit", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const message = Sync.message(rootId, "msg_1", 2)
      yield* sync.uploadMessages(host, rootId, upload, [message])
      const row = Sync.session(rootId, { title: "Committed" })
      const release = yield* hold("opencode_session", "share")
      const commit = yield* Effect.forkChild(
        sync.commit(host, rootId, upload, { session: row, seq: 2, ids: [message.id] }),
      )
      yield* blocked(1)
      const restore = yield* Effect.forkChild(sync.restore(host, rootId))
      yield* Effect.raceFirst(Fiber.await(restore).pipe(Effect.asVoid), blocked(2))
      yield* release
      yield* Fiber.join(commit)
      expect(yield* Fiber.join(restore)).toEqual([row])
    }),
  )

  it.live("a commit that starts while a restore holds the session waits for it and is stale", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const message = Sync.message(rootId, "msg_1", 2)
      yield* sync.uploadMessages(host, rootId, upload, [message])
      const release = yield* hold("opencode_session", "access exclusive")
      const restore = yield* Effect.forkChild(sync.restore(host, rootId))
      yield* blocked(1)
      const commit = yield* Effect.forkChild(
        Effect.flip(sync.commit(host, rootId, upload, { session: Sync.session(rootId), seq: 2, ids: [message.id] })),
      )
      yield* Effect.raceFirst(Fiber.await(commit).pipe(Effect.asVoid), blocked(2))
      yield* release
      expect(yield* Fiber.join(restore)).toEqual([])
      expect(yield* Fiber.join(commit)).toBeInstanceOf(StaleUploadError)
      expect((yield* stored(rootId)).opencode).toBeUndefined()
    }),
  )

  it.live(
    "a child and a grandchild keep their parent and take the root, organization, space and creator from it, before the parent commits",
    () =>
      Effect.gen(function* () {
        const sync = yield* SessionSync.Service
        const { owner, host, rootId } = yield* tree()
        const childId = Session.ID.create()
        const grandchildId = Session.ID.create()
        yield* sync.startUpload(host, childId, { harness: "opencode", parentId: rootId })
        yield* sync.startUpload(host, grandchildId, { harness: "opencode", parentId: childId })
        const adopted = {
          root_id: rootId,
          organization_id: owner.organizationId,
          space_id: owner.spaceId,
          created_by: owner.createdBy,
          harness: "opencode",
          start_input: null,
        }
        expect((yield* stored(childId)).sessions).toMatchObject([{ id: childId, parent_id: rootId, ...adopted }])
        expect((yield* stored(grandchildId)).sessions).toMatchObject([
          { id: grandchildId, parent_id: childId, ...adopted },
        ])
      }),
  )

  it.live("a host cannot start an upload of, restore or read a session outside its root and organization", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { owner, host, rootId } = yield* tree()
      const otherRoot = yield* Seed.session(owner)
      const otherOrganization = { brainId: rootId, organizationId: yield* Seed.organization() }
      const unknownChild = Session.ID.create()
      const attempts: ReadonlyArray<Effect.Effect<unknown, ForbiddenError>> = [
        sync.startUpload(host, Session.ID.create(), { harness: "opencode", parentId: null }),
        sync.startUpload(host, unknownChild, { harness: "opencode", parentId: Session.ID.create() }),
        sync.startUpload(host, otherRoot, { harness: "opencode", parentId: null }),
        sync.startUpload(host, unknownChild, { harness: "opencode", parentId: otherRoot }),
        sync.startUpload(otherOrganization, rootId, { harness: "opencode", parentId: null }),
        sync.restore(host, otherRoot),
        sync.messages(host, otherRoot, { limit: 10 }),
      ]
      for (const attempt of attempts) expect(yield* Effect.flip(attempt)).toBeInstanceOf(ForbiddenError)
      expect((yield* stored(unknownChild)).sessions).toEqual([])
      expect((yield* stored(otherRoot)).sessions).toMatchObject([{ sync_upload: 0, sync_upload_open: false }])
    }),
  )

  it.live("a row of another session in a batch or a commit is forbidden, and Ren writes nothing", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { owner, host, rootId } = yield* tree()
      const otherRoot = yield* Seed.session(owner)
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const attempts = [
        sync.uploadMessages(host, rootId, upload, [
          Sync.message(rootId, "msg_own", 2),
          Sync.message(otherRoot, "msg_other", 3),
        ]),
        sync.commit(host, rootId, upload, { session: Sync.session(otherRoot), seq: 2, ids: [] }),
      ]
      for (const attempt of attempts) expect(yield* Effect.flip(attempt)).toBeInstanceOf(ForbiddenError)
      const own = yield* stored(rootId)
      const other = yield* stored(otherRoot)
      expect([own.opencode, other.opencode]).toEqual([undefined, undefined])
      expect([...own.messages, ...other.messages]).toEqual([])
      expect(own.sessions).toMatchObject([{ sync_seq: null, sync_upload: upload, sync_upload_open: true }])
    }),
  )

  it.live("restore closes the open upload and clears the checkpoint of each session of the tree", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      yield* Sync.pass(host, Sync.session(rootId), 5, [Sync.message(rootId, "msg_1", 2)])
      yield* Sync.pass(host, Sync.session(Session.ID.create(), { parent_id: rootId }), 3, [])
      const open = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      yield* sync.restore(host, rootId)
      expect(
        yield* Effect.flip(sync.uploadMessages(host, rootId, open, [Sync.message(rootId, "msg_late", 6)])),
      ).toBeInstanceOf(StaleUploadError)
      expect((yield* sync.checkpoints(host)).map((checkpoint) => checkpoint.syncSeq)).toEqual([null, null])
    }),
  )

  it.live("restore pages messages in (seq, id) order with no gaps, also when rows share a seq", () =>
    Effect.gen(function* () {
      const { host, rootId } = yield* tree()
      const messages = [
        Sync.message(rootId, "msg_e", 3),
        Sync.message(rootId, "msg_c", 2),
        Sync.message(rootId, "msg_a", 1),
        Sync.message(rootId, "msg_d", 2),
        Sync.message(rootId, "msg_b", 2),
      ]
      yield* Sync.pass(host, Sync.session(rootId), 3, messages)
      expect((yield* pages(host, rootId)).map((message) => message.id)).toEqual([
        "msg_a",
        "msg_b",
        "msg_c",
        "msg_d",
        "msg_e",
      ])
    }),
  )

  it.live("after a pass that stopped halfway after an import, restore pages follow the transcript", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const transcript = [
        Sync.message(rootId, "msg_z", 2),
        Sync.message(rootId, "msg_y", 3),
        Sync.message(rootId, "msg_x", 34),
        Sync.message(rootId, "msg_w", 40),
      ]
      yield* Sync.pass(host, Sync.session(rootId), 40, transcript)
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      yield* sync.uploadMessages(
        host,
        rootId,
        upload,
        transcript.slice(0, 2).map((message, index) => Sync.message(rootId, message.id, index + 1)),
      )
      yield* sync.restore(host, rootId)
      expect((yield* pages(host, rootId)).map((message) => message.id)).toEqual(transcript.map((message) => message.id))
    }),
  )

  it.live("checkpoints returns only the sessions of the scope, with sync_seq and the Ren time_suspended", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { owner, host, rootId } = yield* tree()
      const childId = Session.ID.create()
      const otherRoot = yield* Seed.session(owner)
      yield* Sync.pass(host, Sync.session(rootId, { time_suspended: Sync.now + 1 }), 7, [])
      yield* sync.startUpload(host, childId, { harness: "opencode", parentId: rootId })
      yield* Sync.pass({ brainId: otherRoot, organizationId: owner.organizationId }, Sync.session(otherRoot), 3, [])
      expect(yield* sync.checkpoints(host)).toEqual([
        { id: rootId, syncSeq: 7, timeSuspended: Sync.now + 1 },
        { id: childId, syncSeq: null, timeSuspended: null },
      ])
    }),
  )

  it.live("a row is the same after an upload and a restore read: JSON text, bigint times and real values", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const json = JSON.stringify({ output: "tool output with \u0000 and ünïcode", nested: { b: 1, a: [2, 1] } })
      const row = Sync.session(rootId, {
        metadata: json,
        cost: 0.1 + 0.2,
        tokens_input: 2 ** 53 - 1,
        time_created: Sync.now,
        time_suspended: 8_640_000_000_000_000,
      })
      const message = Sync.message(rootId, "msg_1", 2 ** 40, { data: json })
      yield* Sync.pass(host, row, 2 ** 40, [message])
      expect(yield* sync.restore(host, rootId)).toEqual([row])
      expect(yield* pages(host, rootId)).toEqual([message])
    }),
  )

  it.live(
    "restore returns the tree with each parent before its children, also when a child was adopted in an older transaction",
    () =>
      Effect.gen(function* () {
        const sync = yield* SessionSync.Service
        const database = yield* Database.Service
        const { host, rootId } = yield* tree()
        const root = Sync.session(rootId)
        const child = Sync.session(Session.ID.create(), { parent_id: rootId })
        const grandchild = Sync.session(Session.ID.create(), { parent_id: child.id })
        yield* Effect.forEach([root, child, grandchild], (row) => Sync.pass(host, row, 2, []))
        yield* Effect.forEach([grandchild, child], (row, index) =>
          database.db
            .update(Database.Schema.agent_session)
            .set({ created_at: new Date(index * 1000) })
            .where(eq(Database.Schema.agent_session.id, row.id)),
        )
        expect(yield* sync.restore(host, rootId)).toEqual([root, child, grandchild])
      }),
  )
})
