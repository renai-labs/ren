import { describe, expect } from "bun:test"
import { ForbiddenError, StaleUploadError } from "@ren/host-api/errors"
import type { CurrentHost } from "@ren/host-api/ren-host-api"
import type { Sync } from "@ren/schema/sync"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { and, asc, eq, isNotNull } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer, Schedule, Struct } from "effect"
import { SqlClient } from "effect/sql"
import { SessionSync } from "../src/session-sync.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SyncFixture } from "./lib/sync-fixture.js"

const it = testEffect(SessionSync.layer.pipe(Layer.provideMerge(Testing.layer)))

const tree = Effect.fnUntraced(function* () {
  const owner = yield* Seed.owner()
  const rootId = yield* Seed.session(owner)
  return { owner, rootId, host: SyncFixture.host(owner.organizationId, rootId) }
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
    messages: (yield* database.db
      .select()
      .from(Database.Schema.opencode_message)
      .where(eq(Database.Schema.opencode_message.session_id, sessionId))
      .orderBy(asc(Database.Schema.opencode_message.seq), asc(Database.Schema.opencode_message.id))).map(
      (row): Sync.OpenCodeMessageRow => Struct.omit(row, ["removed_at"]),
    ),
    removed: (yield* database.db
      .select({ id: Database.Schema.opencode_message.id })
      .from(Database.Schema.opencode_message)
      .where(
        and(
          eq(Database.Schema.opencode_message.session_id, sessionId),
          isNotNull(Database.Schema.opencode_message.removed_at),
        ),
      )).map((row) => row.id),
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
): Effect.Effect<ReadonlyArray<Sync.OpenCodeMessageRow>, ForbiddenError, SessionSync.Service> =>
  SessionSync.Service.pipe(
    Effect.flatMap((sync) => sync.messages(host, sessionId, { after, limit: 2 })),
    Effect.flatMap((page) =>
      page.next
        ? pages(host, sessionId, page.next).pipe(Effect.map((rest) => [...page.messages, ...rest]))
        : Effect.succeed(page.messages),
    ),
  )

describe("SessionSync", () => {
  it.live("a pass replaces the Ren copy, so edited rows change and rows it did not send are marked removed", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const prompt = SyncFixture.message(rootId, "msg_1", 2)
      const reply = SyncFixture.message(rootId, "msg_2", 3)
      const idle = SyncFixture.message(rootId, "msg_3", 34)
      yield* SyncFixture.pass(host, SyncFixture.session(rootId, { time_suspended: SyncFixture.now }), 5, [
        prompt,
        reply,
        idle,
      ])
      const edited = SyncFixture.message(rootId, prompt.id, prompt.seq, { data: JSON.stringify({ text: "edited" }) })
      const row = SyncFixture.session(rootId, {
        title: "Fix the build",
        idle_outcome: "completed",
        time_updated: SyncFixture.now + 9,
      })
      yield* SyncFixture.pass(host, row, 40, [edited, idle])
      expect(yield* stored(rootId)).toMatchObject({ messages: [edited, reply, idle], removed: [reply.id] })
      expect((yield* sync.restore(host, rootId)).map((chat) => chat.session)).toEqual([row])
    }),
  )

  it.live("a batch or a commit with an old upload number is stale", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const old = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const current = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const late = SyncFixture.message(rootId, "msg_late", 2)
      expect(yield* Effect.flip(sync.uploadMessages(host, rootId, old, [late]))).toBeInstanceOf(StaleUploadError)
      expect(
        yield* Effect.flip(
          sync.commit(host, rootId, old, { session: SyncFixture.session(rootId), seq: 2, ids: [late.id] }),
        ),
      ).toBeInstanceOf(StaleUploadError)
      const kept = SyncFixture.message(rootId, "msg_kept", 3)
      yield* sync.uploadMessages(host, rootId, current, [kept])
      yield* sync.commit(host, rootId, current, { session: SyncFixture.session(rootId), seq: 3, ids: [kept.id] })
      expect((yield* stored(rootId)).messages).toEqual([kept])
    }),
  )

  it.live("a commit closes its upload, so a late batch or a second copy of the commit is stale", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const kept = SyncFixture.message(rootId, "msg_kept", 2)
      const commit = { session: SyncFixture.session(rootId), seq: 2, ids: [kept.id] }
      yield* sync.uploadMessages(host, rootId, upload, [kept])
      yield* sync.commit(host, rootId, upload, commit)
      expect(
        yield* Effect.flip(sync.uploadMessages(host, rootId, upload, [SyncFixture.message(rootId, "msg_late", 3)])),
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
      const message = SyncFixture.message(childId, "msg_1", 2)
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
      const message = SyncFixture.message(rootId, "msg_1", 2)
      yield* sync.uploadMessages(host, rootId, upload, [message])
      const row = SyncFixture.session(rootId, { title: "Committed" })
      const release = yield* hold("opencode_session", "share")
      const commit = yield* Effect.forkChild(
        sync.commit(host, rootId, upload, { session: row, seq: 2, ids: [message.id] }),
      )
      yield* blocked(1)
      const restore = yield* Effect.forkChild(sync.restore(host, rootId))
      yield* Effect.raceFirst(Fiber.await(restore).pipe(Effect.asVoid), blocked(2))
      yield* release
      yield* Fiber.join(commit)
      expect((yield* Fiber.join(restore)).map((chat) => chat.session)).toEqual([row])
    }),
  )

  it.live("a commit that starts while a restore holds the session waits for it and is stale", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      const message = SyncFixture.message(rootId, "msg_1", 2)
      yield* sync.uploadMessages(host, rootId, upload, [message])
      const release = yield* hold("opencode_session", "access exclusive")
      const restore = yield* Effect.forkChild(sync.restore(host, rootId))
      yield* blocked(1)
      const commit = yield* Effect.forkChild(
        Effect.flip(
          sync.commit(host, rootId, upload, { session: SyncFixture.session(rootId), seq: 2, ids: [message.id] }),
        ),
      )
      yield* Effect.raceFirst(Fiber.await(commit).pipe(Effect.asVoid), blocked(2))
      yield* release
      expect((yield* Fiber.join(restore)).map((chat) => chat.session)).toEqual([null])
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
      const otherOrganization = SyncFixture.host(yield* Seed.organization(), rootId)
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
          SyncFixture.message(rootId, "msg_own", 2),
          SyncFixture.message(otherRoot, "msg_other", 3),
        ]),
        sync.commit(host, rootId, upload, { session: SyncFixture.session(otherRoot), seq: 2, ids: [] }),
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
      yield* SyncFixture.pass(host, SyncFixture.session(rootId), 5, [SyncFixture.message(rootId, "msg_1", 2)])
      yield* SyncFixture.pass(host, SyncFixture.session(Session.ID.create(), { parent_id: rootId }), 3, [])
      const open = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      yield* sync.restore(host, rootId)
      expect(
        yield* Effect.flip(sync.uploadMessages(host, rootId, open, [SyncFixture.message(rootId, "msg_late", 6)])),
      ).toBeInstanceOf(StaleUploadError)
      expect((yield* sync.checkpoints(host)).map((checkpoint) => checkpoint.syncSeq)).toEqual([null, null])
    }),
  )

  it.live("restore pages messages in (seq, id) order with no gaps, also when rows share a seq", () =>
    Effect.gen(function* () {
      const { host, rootId } = yield* tree()
      const messages = [
        SyncFixture.message(rootId, "msg_e", 3),
        SyncFixture.message(rootId, "msg_c", 2),
        SyncFixture.message(rootId, "msg_a", 1),
        SyncFixture.message(rootId, "msg_d", 2),
        SyncFixture.message(rootId, "msg_b", 2),
      ]
      yield* SyncFixture.pass(host, SyncFixture.session(rootId), 3, messages)
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
        SyncFixture.message(rootId, "msg_z", 2),
        SyncFixture.message(rootId, "msg_y", 3),
        SyncFixture.message(rootId, "msg_x", 34),
        SyncFixture.message(rootId, "msg_w", 40),
      ]
      yield* SyncFixture.pass(host, SyncFixture.session(rootId), 40, transcript)
      const upload = yield* sync.startUpload(host, rootId, { harness: "opencode", parentId: null })
      yield* sync.uploadMessages(
        host,
        rootId,
        upload,
        transcript.slice(0, 2).map((message, index) => SyncFixture.message(rootId, message.id, index + 1)),
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
      yield* SyncFixture.pass(host, SyncFixture.session(rootId, { time_suspended: SyncFixture.now + 1 }), 7, [])
      yield* sync.startUpload(host, childId, { harness: "opencode", parentId: rootId })
      yield* SyncFixture.pass(SyncFixture.host(owner.organizationId, otherRoot), SyncFixture.session(otherRoot), 3, [])
      expect(yield* sync.checkpoints(host)).toEqual([
        { id: rootId, syncSeq: 7, timeSuspended: SyncFixture.now + 1 },
        { id: childId, syncSeq: null, timeSuspended: null },
      ])
    }),
  )

  it.live("checkpoints of a space brain list every chat of that brain and none of another brain", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const owner = yield* Seed.owner()
      const brainId = Brain.ID.create()
      const first = yield* Seed.session({ ...owner, brainId })
      const second = yield* Seed.session({ ...owner, brainId })
      const elsewhere = yield* Seed.session(owner)
      const host = { brainId, organizationId: owner.organizationId, spaceId: owner.spaceId, generation: 1 }
      yield* SyncFixture.pass(host, SyncFixture.session(first), 4, [])
      yield* SyncFixture.pass(host, SyncFixture.session(second), 5, [])
      expect(
        yield* Effect.flip(sync.startUpload(host, elsewhere, { harness: "opencode", parentId: null })),
      ).toBeInstanceOf(ForbiddenError)
      expect(
        Object.fromEntries((yield* sync.checkpoints(host)).map((checkpoint) => [checkpoint.id, checkpoint.syncSeq])),
      ).toEqual({ [first]: 4, [second]: 5 })
    }),
  )

  it.live(
    "restore of one chat of a space brain returns its group only, parents first, and leaves another chat's checkpoint",
    () =>
      Effect.gen(function* () {
        const sync = yield* SessionSync.Service
        const owner = yield* Seed.owner()
        const brainId = Brain.ID.create()
        const first = yield* Seed.session({ ...owner, brainId })
        const second = yield* Seed.session({ ...owner, brainId })
        const child = Session.ID.create()
        const host = { brainId, organizationId: owner.organizationId, spaceId: owner.spaceId, generation: 1 }
        yield* SyncFixture.pass(host, SyncFixture.session(first), 4, [])
        yield* SyncFixture.pass(host, SyncFixture.session(child, { parent_id: first }), 3, [])
        yield* SyncFixture.pass(host, SyncFixture.session(second), 5, [])
        expect((yield* sync.restore(host, child)).map((row) => row.id)).toEqual([first, child])
        expect(
          Object.fromEntries((yield* sync.checkpoints(host)).map((checkpoint) => [checkpoint.id, checkpoint.syncSeq])),
        ).toEqual({ [first]: null, [child]: null, [second]: 5 })
      }),
  )

  it.live(
    "a commit without a message marks it removed and keeps its row; restore skips it; a later upload brings it back",
    () =>
      Effect.gen(function* () {
        const { host, rootId } = yield* tree()
        const kept = SyncFixture.message(rootId, "msg_1", 2)
        const dropped = SyncFixture.message(rootId, "msg_2", 3)
        yield* SyncFixture.pass(host, SyncFixture.session(rootId), 5, [kept, dropped])
        yield* SyncFixture.pass(host, SyncFixture.session(rootId), 6, [kept])
        expect(yield* stored(rootId)).toMatchObject({ messages: [kept, dropped], removed: ["msg_2"] })
        expect((yield* pages(host, rootId)).map((row) => row.id)).toEqual(["msg_1"])
        yield* SyncFixture.pass(host, SyncFixture.session(rootId), 7, [kept, dropped])
        expect(yield* stored(rootId)).toMatchObject({ messages: [kept, dropped], removed: [] })
        expect((yield* pages(host, rootId)).map((row) => row.id)).toEqual(["msg_1", "msg_2"])
      }),
  )

  it.live("a row is the same after an upload and a restore read: JSON text, bigint times and real values", () =>
    Effect.gen(function* () {
      const sync = yield* SessionSync.Service
      const { host, rootId } = yield* tree()
      const json = JSON.stringify({
        output: "tool output with \u0000, a lone \ud800 and ünïcode",
        nested: { b: 1, a: [2, 1] },
      })
      const row = SyncFixture.session(rootId, {
        metadata: json,
        cost: Number.MAX_VALUE / 3,
        tokens_input: 2 ** 53 - 1,
        time_created: SyncFixture.now,
        time_suspended: 8_640_000_000_000_000,
      })
      const message = SyncFixture.message(rootId, "msg_1", 2 ** 40, { data: json })
      yield* SyncFixture.pass(host, row, 2 ** 40, [message])
      expect((yield* sync.restore(host, rootId)).map((chat) => chat.session)).toEqual([row])
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
        const root = SyncFixture.session(rootId)
        const child = SyncFixture.session(Session.ID.create(), { parent_id: rootId })
        const grandchild = SyncFixture.session(Session.ID.create(), { parent_id: child.id })
        yield* Effect.forEach([root, child, grandchild], (row) => SyncFixture.pass(host, row, 2, []))
        yield* Effect.forEach([grandchild, child], (row, index) =>
          database.db
            .update(Database.Schema.agent_session)
            .set({ created_at: new Date(index * 1000) })
            .where(eq(Database.Schema.agent_session.id, row.id)),
        )
        expect((yield* sync.restore(host, rootId)).map((chat) => chat.session)).toEqual([root, child, grandchild])
      }),
  )
})
